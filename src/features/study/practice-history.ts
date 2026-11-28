export const practiceHistoryLimit = 50

export type PracticeBookmark = { position: number; seed?: string; id?: string }
export type PracticeHistory = { entries: PracticeBookmark[]; cursor: number; filtered: boolean; empty: boolean }
export type PracticeDirection = 'previous' | 'next'

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

export function sameBookmark(left: PracticeBookmark, right: PracticeBookmark) {
  return left.position === right.position && left.seed === right.seed
}

function validBookmark(value: unknown): value is PracticeBookmark {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<PracticeBookmark>
  return Number.isSafeInteger(entry.position) && entry.position! >= 0 && entry.position! < 100000
    && (entry.seed === undefined || (typeof entry.seed === 'string' && uuid.test(entry.seed) && entry.position! < 15))
    && (entry.id === undefined || (typeof entry.id === 'string' && uuid.test(entry.id)))
}

export function restorePracticeHistory(value: unknown, start: PracticeBookmark): PracticeHistory {
  const saved = value as Partial<PracticeHistory> | null | undefined
  if (Array.isArray(saved?.entries) && saved.entries.length > 0 && saved.entries.length <= practiceHistoryLimit
    && saved.entries.every(validBookmark) && Number.isSafeInteger(saved.cursor)
    && saved.cursor! >= 0 && saved.cursor! < saved.entries.length) {
    const history = { entries: saved.entries, cursor: saved.cursor!, filtered: saved.filtered === true, empty: saved.empty === true }
    return sameBookmark(history.entries[history.cursor], start)
      ? history : addPracticeBookmark({ ...history, filtered: false }, start, 'next')
  }
  return { entries: [start], cursor: 0, filtered: false, empty: false }
}

export function findPracticeBookmark(history: PracticeHistory, direction: PracticeDirection, eligible: (entry: PracticeBookmark) => boolean) {
  const step = direction === 'previous' ? -1 : 1
  for (let index = history.cursor + step; index >= 0 && index < history.entries.length; index += step) {
    if (eligible(history.entries[index])) return index
  }
  return -1
}

export function addPracticeBookmark(history: PracticeHistory, bookmark: PracticeBookmark, direction: PracticeDirection | 'jump') {
  if (sameBookmark(history.entries[history.cursor], bookmark)) return { ...history, empty: false }
  if (direction === 'previous') {
    return { ...history, entries: [bookmark, ...history.entries].slice(0, practiceHistoryLimit), cursor: 0, empty: false }
  }
  const preceding = direction === 'jump' ? history.entries.slice(0, history.cursor + 1) : history.entries
  const entries = [...preceding, bookmark].slice(-practiceHistoryLimit)
  return { ...history, entries, cursor: entries.length - 1, empty: false }
}

export function identifyPracticeBookmark(history: PracticeHistory, id: string) {
  if (history.entries[history.cursor].id === id) return history
  return { ...history, entries: history.entries.map((entry, index) => index === history.cursor ? { ...entry, id } : entry) }
}
