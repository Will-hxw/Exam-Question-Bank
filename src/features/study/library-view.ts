import { libraryPageSize, type QuestionType, type Status } from './api'

export type LibraryList = 'all' | 'wrong' | 'favorite'
export type LibraryView = { search: string; type: QuestionType | ''; topic: string; status: Status | ''; limit: number; page: number }
export const libraryPageSizes = [10, libraryPageSize, 30, 50]

export function readLibraryView(value: unknown): LibraryView {
  const saved = value as Partial<LibraryView> | undefined
  return {
    search: typeof saved?.search === 'string' ? saved.search.slice(0, 100) : '',
    type: saved?.type === 'single' || saved?.type === 'multiple' ? saved.type : '',
    topic: typeof saved?.topic === 'string' && /^[a-z0-9-]{1,50}$/i.test(saved.topic) ? saved.topic : '',
    status: saved?.status && ['done', 'undone', 'wrong', 'favorite'].includes(saved.status) ? saved.status : '',
    limit: typeof saved?.limit === 'number' && libraryPageSizes.includes(saved.limit) ? saved.limit : libraryPageSize,
    page: typeof saved?.page === 'number' && Number.isSafeInteger(saved.page) && saved.page >= 0 && saved.page <= 2000 ? saved.page : 0,
  }
}

export function validLibraryEdits(value: object) {
  const fields: Record<string, unknown> = readLibraryView(value)
  return Object.entries(value).every(([name, edit]) => Object.hasOwn(fields, name) && fields[name] === edit)
}
