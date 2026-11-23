"""Record a frozen batch of author cards and independent decisions in the Git bank."""

import argparse
import csv
import hashlib
import json
import uuid
from pathlib import Path

CONTENT = Path(__file__).resolve().parents[2] / "content"


def jsonl(path):
    with path.open(encoding="utf-8") as source:
        return {item["blindId"]: item for line in source if line.strip() for item in [json.loads(line)]}


def dump(name, rows):
    path = CONTENT / name
    temporary = path.with_suffix(".pending")
    temporary.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    temporary.replace(path)


def stage(blind_path, author_path, review_path, reviewer, today, scope, task_type, selected, practice_reviewed):
    blind, authors = jsonl(blind_path), jsonl(author_path)
    with review_path.open(encoding="utf-8", newline="") as source:
        decisions = list(csv.DictReader(source))
    if len({row["blind_id"] for row in decisions}) != len(decisions):
        raise ValueError("The review file has repeated question IDs.")
    if selected:
        decisions = [row for row in decisions if row["blind_id"] in selected]
        if set(selected) != {row["blind_id"] for row in decisions}:
            raise ValueError("A selected question has no matching independent review.")
    points = json.loads((CONTENT / "knowledge-points.json").read_text(encoding="utf-8"))
    questions = json.loads((CONTENT / "questions.json").read_text(encoding="utf-8"))
    practice = json.loads((CONTENT / "practice-reviews.json").read_text(encoding="utf-8"))
    existing = {point["factKey"] for point in points}
    staged = 0

    for result in decisions:
        card = authors[result["blind_id"]]
        original = blind[result["blind_id"]]
        if card["factKey"] in existing:
            raise ValueError(f"Use the existing question and option IDs for {card['factKey']}.")
        if card["stem"] != original["stem"] or [option["text"] for option in card["options"]] != original["options"]:
            raise ValueError(f"Blind and author cards differ: {result['blind_id']}.")
        author_answer = [chr(65 + i) for i, option in enumerate(card["options"]) if option["correct"]]
        independent = list(result["independent_answer"].replace("+", ""))
        allowed_letters = {chr(65 + index) for index in range(len(card["options"]))}
        if not independent or not set(independent) <= allowed_letters or len(set(independent)) != len(independent):
            raise ValueError(f"Invalid independent selections: {result['blind_id']}.")
        accepted = result["decision"] == "approved"
        if accepted and set(author_answer) != set(independent):
            raise ValueError(f"Resolve the answer disagreement before staging: {result['blind_id']}.")
        citation = card["sources"][0]
        point_id = str(uuid.uuid4())
        points.append(dict(id=point_id, topicId=card["topic"], factKey=card["factKey"], fact=card["fact"],
                           importance=card["level"], sourceId=citation["id"], location=citation["location"], scopeNote=scope))
        existing.add(card["factKey"])
        options = [
            dict(id=str(uuid.uuid4()), text=option["text"], rationale=option["rationale"], evidence=[
                dict(sourceId=option["sourceId"], location=option["location"], claim=option["rationale"])
            ])
            for option in card["options"]
        ]
        answer_ids = [options[ord(letter) - 65]["id"] for letter in author_answer]
        question = dict(id=str(uuid.uuid4()), state="ready" if accepted else "draft", topicId=card["topic"], knowledgePointId=point_id,
                        relatedKnowledgePointIds=[], type=card["type"], stem=card["stem"], scopeNote=scope,
                        difficulty="intermediate", taskType=task_type,
                        difficultyReason="根据题干指定的文献及适用范围对比选项。",
                        emotionOnly=card["emotionOnly"], emotionReason=card["emotionReason"], orderLocked=card.get("orderLocked", False),
                        options=options, answerIds=answer_ids, explanation=card["explanation"],
                        distinction=card.get("distinction", card["explanation"]), evidence=[
                            dict(sourceId=entry["id"], location=entry["location"], claim=entry["claim"]) for entry in card["sources"]
                        ])
        canonical = {key: value for key, value in question.items() if key != "state"}
        digest = hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        question["reviews"] = {
            "initial": dict(reviewer=card["review"]["author"], date=today, choice=answer_ids, decision="approved",
                            emotionOnly=card["emotionOnly"], notes=card["review"]["notes"], digest=digest),
            "independent": dict(reviewer=result.get("reviewer") or reviewer, date=today,
                                choice=[options[ord(letter) - 65]["id"] for letter in independent],
                                decision="approved" if accepted else "changes", emotionOnly=card["emotionOnly"],
                                notes=result["review_note"], digest=digest),
        }
        questions.append(question)
        if practice_reviewed and accepted:
            practice.append(dict(questionId=question["id"], digest=digest, reviewer=result.get("reviewer") or reviewer,
                                 decision="keep", reason=result["review_note"], proposal=""))
        staged += int(accepted)

    dump("knowledge-points.json", points)
    dump("questions.json", questions)
    if practice_reviewed:
        dump("practice-reviews.json", practice)
    print(f"{staged} ready, {len(decisions) - staged} returned for revision")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("blind", "author", "review"):
        parser.add_argument(arg, type=Path)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--scope", required=True)
    parser.add_argument("--task-type", choices=["recall", "distinction", "application"], default="distinction")
    parser.add_argument("--select", nargs="+")
    parser.add_argument("--practice-reviewed", action="store_true")
    args = parser.parse_args()
    stage(args.blind, args.author, args.review, args.reviewer, args.date, args.scope, args.task_type,
          args.select, args.practice_reviewed)
