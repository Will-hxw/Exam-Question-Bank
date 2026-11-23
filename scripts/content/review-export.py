"""Export the fact-checked question bank for reading and manual review."""

import json
from pathlib import Path
from string import ascii_uppercase

ROOT = Path(__file__).resolve().parents[2]


def read_content(name):
    return json.loads((ROOT / "content" / name).read_text(encoding="utf-8"))


def review_question(question):
    letters = {
        option["id"]: letter
        for letter, option in zip(ascii_uppercase, question["options"])
    }
    return {
        "id": question["id"],
        "type": question["type"],
        "question": question["stem"],
        "options": {letters[option["id"]]: option["text"] for option in question["options"]},
        "answer": sorted(letters[option_id] for option_id in question["answerIds"]),
        "explanation": question["explanation"],
    }


def main():
    topics = read_content("topics.json")
    questions = [item for item in read_content("questions.json") if item["state"] == "ready"]
    grouped = [
        {
            "id": topic["id"],
            "name": topic["name"],
            "questions": [review_question(item) for item in questions if item["topicId"] == topic["id"]],
        }
        for topic in topics
    ]
    if sum(len(topic["questions"]) for topic in grouped) != len(questions):
        raise ValueError("The export did not include every fact-checked question.")

    destination = ROOT / "tmp" / "题库全量审阅.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(grouped, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(questions)} questions from {len(topics)} topics.")


if __name__ == "__main__":
    main()
