"""Replace independently checked questions with new question and option IDs."""

import argparse
import csv
import hashlib
import json

from pathlib import Path
from uuid import uuid4

CONTENT = Path(__file__).resolve().parents[2] / "content"


def lines(path):
    return {row["blindId"]: row for row in map(json.loads, path.read_text(encoding="utf-8").splitlines())}


def read(name):
    return json.loads((CONTENT / name).read_text(encoding="utf-8"))


def save(name, data):
    path = CONTENT / name
    temporary = path.with_suffix(".pending")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for file in ("blind", "author", "independent"):
        parser.add_argument(file, type=Path)
    parser.add_argument("--select", nargs="+", required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    blind, author = lines(args.blind), lines(args.author)
    with args.independent.open(encoding="utf-8-sig", newline="") as source:
        independent = {row["blind_id"]: row for row in csv.DictReader(source)}
    questions = read("questions.json")
    current = {row["id"]: row for row in questions}
    practice = {row["questionId"]: row for row in read("practice-reviews.json")}
    order = read("question-order.json")

    for key in args.select:
        proposal, review, seen = author[key], independent[key], blind[key]
        previous = current[proposal["questionId"]]
        texts = [option["text"] for option in proposal["options"]]
        if previous["state"] != "ready":
            raise ValueError(f"The question must be ready before it can be replaced: {key}.")
        if review["decision"] != "approved" or seen["stem"] != proposal["stem"] or seen["options"] != texts:
            raise ValueError(f"Revision does not match the independently approved question {key}.")
        if proposal["topic"] != previous["topicId"] or proposal["knowledgePointId"] != previous["knowledgePointId"]:
            raise ValueError(f"Use the new-question workflow when the examined fact changes: {key}.")
        options = [
            dict(id=str(uuid4()), text=option["text"], rationale=option["rationale"],
                 evidence=[dict(sourceId=option["sourceId"], location=option["location"], claim=option["rationale"])])
            for option in proposal["options"]
        ]
        chosen = [
            options[position]["id"] for position, option in enumerate(proposal["options"]) if option["correct"]
        ]
        independent_choices = [options[ord(letter) - 65]["id"] for letter in review["independent_answer"].replace("+", "")]
        if len(chosen) != len(independent_choices) or set(chosen) != set(independent_choices):
            raise ValueError(f"Unresolved independent answer conflict: {key}.")
        item = previous.copy()
        item.update(id=str(uuid4()), type=proposal["type"], stem=proposal["stem"], options=options, answerIds=chosen,
                    explanation=proposal["explanation"], distinction=proposal.get("distinction") or proposal["explanation"],
                    taskType=proposal.get("taskType", "recall"),
                    difficulty="basic", difficultyReason="直接考查指定考点的原文术语、主体或时限。",
                    emotionOnly=proposal["emotionOnly"], emotionReason=proposal["emotionReason"],
                    orderLocked=proposal.get("orderLocked", False),
                    evidence=[dict(sourceId=entry["id"], location=entry["location"], claim=entry["claim"])
                              for entry in proposal["sources"]])
        canonical = {field: value for field, value in item.items() if field not in {"reviews", "state"}}
        digest = hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        independent_review = dict(reviewer=args.reviewer, date=args.date, choice=independent_choices,
                                  decision="approved", notes=review["review_note"], emotionOnly=proposal["emotionOnly"], digest=digest)
        item["reviews"] = {
            "initial": dict(reviewer=proposal["review"]["author"], date=args.date, choice=chosen,
                            decision="approved", notes=proposal["review"]["notes"],
                            emotionOnly=proposal["emotionOnly"], digest=digest),
            "independent": independent_review,
        }
        practice[item["id"]] = dict(questionId=item["id"], digest=digest, reviewer=args.reviewer,
                                    decision="keep", reason=review["review_note"], proposal="")
        previous["state"] = "withdrawn"
        questions.append(item)
        order.append(item["id"])

    save("questions.json", questions)
    save("practice-reviews.json", list(practice.values()))
    save("question-order.json", order)
    print(f"Applied {len(args.select)} independently reviewed revisions.")


if __name__ == "__main__":
    main()
