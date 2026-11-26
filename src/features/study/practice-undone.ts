export const practiceUndonePreference = 'practice-only-undone'

export type PracticePosition = { id: string; position: number }

function seededOrder(candidates: PracticePosition[], seed: string) {
  return [...candidates].sort((a, b) => Number(a.id < seed) - Number(b.id < seed) || a.id.localeCompare(b.id))
}

export function initialUndonePosition(candidates: PracticePosition[], saved: number | null, seed?: string) {
  if (seed) {
    // Match the bank's seeded start when there is no saved unattempted question.
    return (candidates.find(({ position }) => position === saved) ?? seededOrder(candidates, seed)[0])?.position ?? null
  }
  return (candidates.find(({ position }) => position >= (saved ?? 0)) ?? candidates[0])?.position ?? null
}

export function stepUndonePosition(
  candidates: PracticePosition[],
  current: PracticePosition,
  direction: 'previous' | 'next',
  seed?: string,
) {
  if (seed) {
    const ordered = seededOrder(candidates, seed)
    const after = ({ id }: PracticePosition) => (id < seed) === (current.id < seed) ? id > current.id : id < seed
    if (direction === 'next') {
      return (ordered.find(after) ?? ordered.find(({ id }) => id !== current.id))?.position ?? null
    }
    return ordered.findLast((candidate) => candidate.id !== current.id && !after(candidate))?.position ?? null
  }
  if (direction === 'next') {
    return (candidates.find(({ position }) => position > current.position)
      ?? candidates.find(({ position }) => position < current.position))?.position ?? null
  }
  return candidates.findLast(({ position }) => position < current.position)?.position ?? null
}
