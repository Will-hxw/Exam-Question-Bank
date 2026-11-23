"""Export every annotated question and option as a readable JSON review packet."""

import csv
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def data(name):
    return json.loads((ROOT / "content" / name).read_text(encoding="utf-8"))


def csv_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def main():
    topics, questions = data("topics.json"), data("questions.json")
    sources = {item["id"]: item for item in data("sources.json")}
    facts = {item["id"]: item for item in data("knowledge-points.json")}
    report = json.loads(subprocess.check_output(["node", "scripts/content/release.mjs", "report"], cwd=ROOT))
    review_dir = ROOT / "research" / "review"
    dispositions = csv_rows(review_dir / "legacy-candidates.csv")
    style = {item["questionId"]: item for item in data("practice-reviews.json")}

    def evidence(refs):
        return [
            {"title": sources[ref["sourceId"]]["title"], "url": sources[ref["sourceId"]]["url"],
             "location": ref["location"], "claim": ref["claim"]}
            for ref in refs
        ]

    def question(item):
        correct = set(item["answerIds"])
        letters = {option["id"]: chr(65 + index) for index, option in enumerate(item["options"])}
        status = style.get(item["id"], {})
        canonical = {key: value for key, value in item.items() if key not in {"reviews", "state"}}
        digest = hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        matches = status.get("digest") == digest
        options = [
            {"label": letters[option["id"]], "id": option["id"], "text": option["text"],
             "correct": option["id"] in correct, "reason": option["rationale"], "evidence": evidence(option["evidence"])}
            for option in item["options"]
        ]
        return {
            "id": item["id"], "type": item["type"], "stem": item["stem"], "options": options,
            "answer": [option["label"] for option in options if option["correct"]],
            "explanation": item["explanation"], "distinction": item["distinction"], "sourceEvidence": evidence(item["evidence"]),
            "knowledgePoint": facts[item["knowledgePointId"]]["fact"], "scope": item["scopeNote"],
            "contentReview": {"state": item["state"], "reviews": item.get("reviews", {})},
            "practiceStyleReview": {"decision": status.get("decision", "pending") if matches else "pending",
                                    "reviewer": status.get("reviewer", "") if matches else "",
                                    "reason": status.get("reason", "") if matches else "",
                                    "proposal": status.get("proposal", "") if matches else ""},
            "inPracticePool": item["state"] == "ready" and matches and status.get("decision") == "keep",
        }

    grouped = [
        {"id": topic["id"], "name": topic["name"], "scope": topic["scopeNote"],
         "questions": [question(item) for item in questions if item["topicId"] == topic["id"]]}
        for topic in topics
    ]
    if sum(len(topic["questions"]) for topic in grouped) != len(questions):
        raise ValueError("Export did not include every question.")
    known = sum(row["disposition"] != "pending" for row in dispositions)
    payload = {
        "scope": "当前 Git 工作题及其全部选项。整库正式发布状态见 readiness。",
        "readiness": {
            "allCurrentQuestions": len(questions),
            "factChecked": report["review"]["ready"],
            "practiceReady": report["review"]["practiceReady"],
            "styleAudited": len(style),
            "legacyTotal": len(dispositions),
            "legacyDispositionCount": known,
            "remainingLegacy": len(dispositions) - known,
            "publicationGaps": report["problems"],
        },
        "topics": grouped,
    }

    destination = ROOT / "tmp" / "题库全量审阅.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Exported {len(questions)} questions and all options from {len(topics)} topics.")


if __name__ == "__main__":
    main()
