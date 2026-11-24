export const MIN_EXAM_QUESTIONS = 1
export const DEFAULT_EXAM_QUESTIONS = 50
export const MAX_EXAM_QUESTIONS = 100

export function isExamQuestionCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_EXAM_QUESTIONS && value <= MAX_EXAM_QUESTIONS
}
