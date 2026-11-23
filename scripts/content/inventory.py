"""Build a structural audit of the pinned legacy bank. No question is approved here."""

import argparse
import csv
import hashlib
import itertools
import json
import subprocess
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path, PurePosixPath

BASE = "5e8d8eaefd8f444237e31a471cb02945ad90adc8"
ROOT = Path(__file__).resolve().parents[2]


def git(*args):
    return subprocess.check_output(["git", "-C", ROOT, *args])


def normalize(text):
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return "".join(char for char in normalized if unicodedata.category(char)[0] in "LMN")


def signature(row):
    options = {option["key"]: normalize(option["text"]) for option in row["options"]}
    return (normalize(row["question"]), tuple(sorted(options.values()))), tuple(
        sorted(options[key] for key in row["answer"])
    )


def trigrams(text):
    return {text[index:index + 3] for index in range(len(text) - 2)}


def similar_pairs(questions, row_keys):
    postings = defaultdict(list)
    grams_by_row = {}
    for row in questions:
        key = row["id"]
        stem, _ = row_keys[key][0]
        grams = trigrams(stem)
        grams_by_row[key] = grams
        for trigram in grams:
            postings[trigram].append(key)

    common_grams = Counter()
    for group in postings.values():
        common_grams.update(itertools.combinations(sorted(group), 2))

    results = []
    for (left, right), shared in sorted(common_grams.items()):
        first, first_options = row_keys[left][0]
        second, second_options = row_keys[right][0]
        union = len(grams_by_row[left]) + len(grams_by_row[right]) - shared
        similarity = shared / union
        if first == second or similarity >= 0.70:
            kind = "same_stem"
            if first != second:
                kind = "trigram"
            elif first_options == second_options:
                kind = "same_stem_and_options"
            results.append((left, right, kind, f"{similarity:.3f}"))
    stems = defaultdict(list)
    for key, ((stem, _), _) in row_keys.items():
        if len(stem) < 3:
            stems[stem].append(key)
    for group in stems.values():
        for left, right in itertools.combinations(sorted(group), 2):
            kind = "same_stem_and_options" if row_keys[left][0] == row_keys[right][0] else "same_stem"
            results.append((left, right, kind, "1.000"))
    return sorted(results)


def write_csv(path, columns, rows, keys):
    previous = {}
    if path.exists():
        with path.open(encoding="utf-8", newline="") as source:
            for row in csv.DictReader(source):
                previous[tuple(row[key] for key in keys)] = (row["disposition"], row["review_note"])
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.writer(target, lineterminator="\n")
        writer.writerow(columns + ("disposition", "review_note"))
        for row in rows:
            status, note = previous.get(tuple(row[:len(keys)]), ("pending", ""))
            writer.writerow((*row, status, note))


def run(output):
    raw = git("show", f"{BASE}:data/questions.json")
    rows = json.loads(raw)
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(rows):
        raise ValueError("The pinned candidate bank has duplicate tracking IDs")
    keys = {row_id: signature(row) for row_id, row in by_id.items()}
    paths = git("ls-tree", "-r", "--name-only", "-z", BASE, "data/json").decode().split("\0")
    mirrors = {}
    mirror_report = []
    for name in filter(None, paths):
        partition = json.loads(git("show", f"{BASE}:{name}"))
        source_name = PurePosixPath(name).stem
        for row in partition:
            mirrors.setdefault(row["id"], []).append((source_name, row))
        mirror_report.append((source_name, len(partition)))

    output.mkdir(parents=True, exist_ok=True)
    records = []
    baseline = Counter()
    for key, row in by_id.items():
        row_signature, old_answer = keys[key]
        memberships = mirrors.get(key, [])
        variants = [signature(mirror) for _, mirror in memberships]
        if any(item[0] != row_signature for item in variants):
            baseline["different_normalized_content"] += 1
        if any(item[0] == row_signature and item[1] != old_answer for item in variants):
            baseline["different_answer_text"] += 1
            print("Answer-set conflict:", key)
        if any(signature(mirror) == keys[key] and mirror["options"] != row["options"] for _, mirror in memberships):
            baseline["answer_preserving_option_variants"] += 1
        records.append((
            key, row["type"], len(row["options"]), len(old_answer),
            " | ".join(name for name, _ in memberships), row.get("source", ""),
            hashlib.sha256(json.dumps(row_signature, ensure_ascii=False).encode()).hexdigest(),
        ))
    write_csv(output / "legacy-candidates.csv",
              ("legacy_id", "type", "option_count", "key_count", "legacy_sections", "legacy_source", "normalized_sha256"),
              records, ("legacy_id",))

    pairs = similar_pairs(rows, keys)
    write_csv(output / "legacy-similarity.csv", ("left_id", "right_id", "match", "similarity"),
              pairs, ("left_id", "right_id"))
    stem_groups = Counter(key[0][0] for key in keys.values())
    print("Commit:", BASE)
    print("Source SHA-256:", hashlib.sha256(raw).hexdigest())
    print("Types:", dict(Counter(row["type"] for row in rows)))
    multiselect = [row for row in rows if row["type"] == "multi"]
    print("All-selected multiple-choice:", sum(len(row["answer"]) == len(row["options"]) for row in multiselect))
    print("Empty explanations:", sum(not row.get("explanation", "").strip() for row in rows))
    print("HTTP(S) sources:", sum("http://" in row["source"] or "https://" in row["source"] for row in rows))
    print("Repeated normalized stems:", sum(count > 1 for count in stem_groups.values()), "groups",
          sum(count for count in stem_groups.values() if count > 1), "rows")
    print("Similarity pairs:", len(pairs), dict(Counter(pair[2] for pair in pairs)))
    print("Partitions:", mirror_report)
    print("Mirror differences:", dict(baseline))
    print("Coverage:", len(rows), "main candidates,", len(set(mirrors) - set(by_id)), "additional mirror IDs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "research" / "review")
    run(parser.parse_args().output)
