export type ExamDraft = { answers: Record<string, string[]>; marked: string[]; position: number; revision: number }
export type StoredExamDraft = { draft: ExamDraft; base: ExamDraft | null; sent?: ExamDraft }
export type ExamAnswerConflict = { id: string; local: string[]; cloud: string[] }

export function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id))
}

export function sameExamAnswers(left: ExamDraft, right: ExamDraft) {
  const ids = new Set([...Object.keys(left.answers), ...Object.keys(right.answers)])
  return [...ids].every((id) => sameIds(left.answers[id] ?? [], right.answers[id] ?? []))
}

export function sameExamDraft(left: ExamDraft, right: ExamDraft) {
  return left.position === right.position && sameIds(left.marked, right.marked) && sameExamAnswers(left, right)
}

function isDraft(value: unknown): value is ExamDraft {
  const draft = value as Partial<ExamDraft> | null
  return !!draft && typeof draft.revision === 'number' && Number.isSafeInteger(draft.revision) && draft.revision >= 0
    && typeof draft.position === 'number' && Number.isSafeInteger(draft.position) && draft.position >= 0
    && Array.isArray(draft.marked) && draft.marked.every((id) => typeof id === 'string')
    && !!draft.answers && typeof draft.answers === 'object' && !Array.isArray(draft.answers)
    && Object.values(draft.answers).every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'))
}

export function decodeExamDraft(value: unknown): StoredExamDraft | null {
  // Drafts saved before conflict recovery contain only the working copy.
  if (isDraft(value)) return { draft: value, base: null }
  const stored = value as Partial<StoredExamDraft> | null
  if (!isDraft(stored?.draft)) return null
  const base = isDraft(stored.base) && stored.base.revision === stored.draft.revision ? stored.base : null
  const sent = isDraft(stored.sent) && stored.sent.revision === stored.draft.revision ? stored.sent : undefined
  return { draft: stored.draft, base, ...(sent ? { sent } : {}) }
}

export function mergeExamDraft(local: ExamDraft, cloud: ExamDraft, base: ExamDraft | null) {
  const ids = new Set([...Object.keys(local.answers), ...Object.keys(cloud.answers)])
  const conflicts: ExamAnswerConflict[] = []
  const answers: ExamDraft['answers'] = Object.fromEntries([...ids].map((id) => {
    const here = local.answers[id] ?? []
    const there = cloud.answers[id] ?? []
    const before = base?.answers[id] ?? []
    const changedHere = base ? !sameIds(here, before) : Object.hasOwn(local.answers, id)
    const changedThere = base ? !sameIds(there, before) : Object.hasOwn(cloud.answers, id)
    if (changedHere && changedThere && !sameIds(here, there)) conflicts.push({ id, local: here, cloud: there })
    return [id, changedHere ? here : there]
  }))

  const localMarks = new Set(local.marked)
  const cloudMarks = new Set(cloud.marked)
  const baseMarks = new Set(base?.marked)
  const markIds = new Set([...localMarks, ...cloudMarks])
  const marked = [...markIds].filter((id) => {
    const here = localMarks.has(id)
    const there = cloudMarks.has(id)
    if (!base) return here || there
    return here === baseMarks.has(id) ? there : here
  })
  const position = base && local.position === base.position ? cloud.position : local.position
  return { draft: { answers, marked, position, revision: cloud.revision }, conflicts }
}

export function unsubmittedAnswerIds(stored: StoredExamDraft, result: ExamDraft) {
  return Object.keys(stored.draft.answers).filter((id) => {
    const local = stored.draft.answers[id]
    return (!stored.base || !sameIds(local, stored.base.answers[id] ?? [])) && !sameIds(local, result.answers[id] ?? [])
  })
}
