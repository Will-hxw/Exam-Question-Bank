const destinations = ['/', '/questions', '/exam', '/wrong', '/favorites'] as const
export type StudyDestination = typeof destinations[number]

export function studyDestination(value: unknown): StudyDestination {
  return destinations.find((path) => path === value) ?? '/'
}

export function studyLoginPath(destination: StudyDestination) {
  return destination === '/' ? '/login' : '/login?' + new URLSearchParams({ next: destination })
}
