export type Topic = { id: string; name: string; count: number }
export type QuestionType = 'single' | 'multiple'
export type Option = { id: string; text: string; rationale?: string }
export type Source = { title: string; url: string; location: string }
export type Explanation = { answerIds: string[]; explanation: string; options: Option[]; sources: Source[] }
export type QuestionState = { attempted: boolean; isFavorite: boolean; isWrong: boolean }
export type Question = {
  id: string
  type: QuestionType
  stem: string
  topicId: string
  contentRevision?: string
  options: Option[]
  answerIds?: string[]
  explanation?: string
  sources?: Source[]
} & Partial<QuestionState>
export type QuestionPage = { questions: Question[]; nextCursor: string | null; total?: number }
export type Status = 'done' | 'undone' | 'wrong' | 'favorite'
export type StudyStats = { attempted: number; wrong: number; favorites: number; preferences?: Record<string, unknown> }
export type Attempt = { eventId: string; questionId: string; optionIds: string[]; mode: 'practice'; contentRevision?: string }

const shardName = /^\/bank\/pages\/([0-9a-f]{64})\.json$/
const manifestUrl = '/bank/manifest.json'
let needsPreviewCookie = false

function previewGate(response: Response) {
  return response.status === 401 && response.headers.get('content-type')?.includes('text/html')
}

async function fetchPublic(path: string, options: RequestInit) {
  if (!needsPreviewCookie) {
    const anonymous = await fetch(path, { ...options, credentials: 'omit' })
    if (!previewGate(anonymous)) return anonymous
  }

  // Makers preview access uses a browser cookie even on otherwise public routes.
  const authorized = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store' })
  if (authorized.ok) needsPreviewCookie = true
  return authorized
}

export class StudyRequestError extends Error {
  readonly status: number

  constructor(status: number, message?: string) {
    super(message ?? (status === 401 || status === 403 ? '登录状态已变更，请重新登录。' : '请求失败，请重试。'))
    this.status = status
  }
}

export function questionUrl({ topic, type, q, cursor, offset, limit, practice, status, random, personal }: {
  topic?: string
  type?: QuestionType | ''
  q?: string
  cursor?: string | null
  offset?: number
  limit?: number
  practice?: boolean
  status?: Status | ''
  random?: boolean | string
  personal?: boolean
}) {
  const params = new URLSearchParams()
  if (topic) params.set('topic', topic)
  if (type) params.set('type', type)
  if (q) params.set('q', q)
  if (cursor) params.set('cursor', cursor)
  else if (offset !== undefined) params.set('offset', String(offset))
  if (limit) params.set('limit', String(limit))
  if (practice) params.set('mode', 'practice')
  if (random) params.set('random', typeof random === 'string' ? random : '1')
  if (status) params.set('status', status)
  return `/api/${personal || status ? 'me' : 'public'}/questions?${params}`
}

export async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isPublic = path.startsWith('/api/public/') || path === manifestUrl || shardName.test(path)
  const requestOptions: RequestInit = {
    cache: isPublic ? 'default' : 'no-store',
    signal: AbortSignal.timeout(9000),
    ...options,
  }
  const response = await (isPublic
    ? fetchPublic(path, requestOptions)
    : fetch(path, { ...requestOptions, credentials: 'same-origin' }))
  if (!response.ok) {
    if (previewGate(response)) {
      throw new StudyRequestError(response.status, '预览访问已过期，请从部署控制台重新打开预览。')
    }
    const body: unknown = await response.json().catch(() => null)
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : undefined
    throw new StudyRequestError(response.status, message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function writeJson<T>(path: string, userId: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, keepalive = false) {
  const headers: Record<string, string> = { 'X-Study-Account': userId }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return requestJson<T>(path, { method, headers, keepalive, body: body === undefined ? undefined : JSON.stringify(body) })
}

const publicPages = new Map<string, { value: unknown; expiresAt: number }>()
const publicRequests = new Map<string, Promise<unknown>>()
export const libraryPageSize = 20
const sha256 = /^[0-9a-f]{64}$/
const topicIdPattern = /^[a-z0-9][a-z0-9-]{0,49}$/
const cursorPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
export const practiceBankPageSize = 15
const pageSize = practiceBankPageSize
type Group = { total: number; pages: string[] }
type BankManifest = { release: string; topics: Topic[]; pageSize: 15; groups: Record<string, Group> }
type BankRead = { kind: 'topics' } | { kind: 'practice'; group: string; offset: number; cursor?: string }

const knownCursors = new Map<string, number>()
let manifest: BankManifest | null = null
let manifestExpires = 0
let manifestAvailable = false
let manifestRequest: Promise<BankManifest | null> | null = null
let watchOnline = false
let cacheEpoch = 0
export const bankReleaseEvent = 'study-bank-release'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function validManifest(value: unknown): value is BankManifest {
  if (!isRecord(value) || typeof value.release !== 'string' || !sha256.test(value.release)
    || value.pageSize !== pageSize || !Array.isArray(value.topics) || !isRecord(value.groups)) return false
  const ids = new Set<string>()
  for (const topic of value.topics) {
    if (!isRecord(topic) || typeof topic.id !== 'string' || !topicIdPattern.test(topic.id) || ids.has(topic.id)
      || typeof topic.name !== 'string' || !topic.name.trim() || typeof topic.count !== 'number'
      || !Number.isSafeInteger(topic.count) || topic.count < 0) return false
    ids.add(topic.id)
  }

  function validGroup(group: unknown, total: number) {
    return isRecord(group) && group.total === total && Array.isArray(group.pages)
      && group.pages.length === Math.ceil(total / pageSize)
      && group.pages.every((path) => typeof path === 'string' && shardName.test(path))
  }

  const total = value.topics.reduce((sum, topic) => sum + topic.count, 0)
  return validGroup(value.groups._all, total) && value.topics.every((topic) => validGroup((value.groups as Record<string, unknown>)[topic.id], topic.count))
}

function resetPublicPages() {
  cacheEpoch += 1
  publicPages.clear()
  publicRequests.clear()
  knownCursors.clear()
}

function bankSelection(path: string): BankRead | null {
  if (path === '/api/public/topics') return { kind: 'topics' }
  if (!path.startsWith('/api/public/questions?')) return null
  const params = new URLSearchParams(path.split('?')[1])
  const allowedKeys = new Set(['topic', 'offset', 'cursor', 'limit', 'mode'])
  if ([...params.keys()].some((key) => !allowedKeys.has(key) || params.getAll(key).length !== 1)
    || params.get('mode') !== 'practice' || params.get('limit') !== String(pageSize)) return null
  const group = params.get('topic') ?? '_all'
  const cursor = params.get('cursor') ?? undefined
  const offsetText = params.get('offset') ?? '0'
  const offset = Number(offsetText)
  if ((group !== '_all' && !topicIdPattern.test(group)) || (cursor && (!cursorPattern.test(cursor) || params.has('offset')))
    || !/^\d+$/.test(offsetText) || !Number.isSafeInteger(offset) || offset % pageSize !== 0) return null
  return { kind: 'practice', group, offset, cursor }
}

async function getManifest(): Promise<BankManifest | null> {
  if (!navigator.onLine) return manifest
  if (Date.now() < manifestExpires) return manifestAvailable ? manifest : null
  if (manifestRequest) return manifestRequest
  manifestRequest = requestJson<unknown>(manifestUrl, {
    cache: 'no-cache', redirect: 'error', signal: AbortSignal.timeout(2500),
  }).then((response) => {
    if (!validManifest(response)) throw new Error('Invalid bank manifest')
    const changed = Boolean(manifest && manifest.release !== response.release)
    manifest = response
    manifestAvailable = true
    manifestExpires = Date.now() + 20_000
    if (changed) {
      resetPublicPages()
      window.dispatchEvent(new Event(bankReleaseEvent))
    }
    return response
  }).catch(() => {
    if (manifestAvailable) resetPublicPages()
    manifestAvailable = false
    manifestExpires = Date.now() + 5_000
    return null
  }).finally(() => { manifestRequest = null })
  return manifestRequest
}

export function validPage(value: unknown, expectedCount: number, group: string, lastPage: boolean): value is QuestionPage {
  if (!isRecord(value) || !Array.isArray(value.questions) || value.questions.length !== expectedCount) return false
  const questions = value.questions as Array<Record<string, unknown>>
  return value.nextCursor === (lastPage ? null : questions.at(-1)?.id)
    && questions.every((question) => isRecord(question) && typeof question.id === 'string' && cursorPattern.test(question.id)
      && typeof question.stem === 'string' && (question.type === 'single' || question.type === 'multiple')
      && typeof question.topicId === 'string' && topicIdPattern.test(question.topicId) && (group === '_all' || question.topicId === group)
      && typeof question.contentRevision === 'string' && sha256.test(question.contentRevision)
      && typeof question.explanation === 'string' && Array.isArray(question.options) && question.options.length >= 2
      && Array.isArray(question.answerIds) && Array.isArray(question.sources))
}

async function readBank(path: string, selection: BankRead) {
  const index = await getManifest()
  if (!index) return requestJson<unknown>(path)
  if (selection.kind === 'topics') return { topics: index.topics }
  const group = index.groups[selection.group]
  const position = selection.cursor ? knownCursors.get(`${selection.group}:${selection.cursor}`) : selection.offset / pageSize
  if (!group || position === undefined) return requestJson<unknown>(path)
  const asset = group.pages[position]
  if (!asset) return { questions: [], nextCursor: null, total: group.total }

  try {
    const digest = shardName.exec(asset)?.[1]
    if (!digest) throw new Error('Invalid bank page path')
    const response = await fetchPublic(asset, { cache: 'force-cache', redirect: 'error', signal: AbortSignal.timeout(3500) })
    if (!response.ok) throw new Error('Bank page unavailable')
    const bytes = await response.arrayBuffer()
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    const checked = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    if (checked !== digest) throw new Error('Bank page digest mismatch')

    const page: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (manifest?.release !== index.release || !validPage(page, Math.min(pageSize, group.total - position * pageSize), selection.group, position === group.pages.length - 1)) {
      throw new Error('Invalid bank page')
    }
    if (page.nextCursor) knownCursors.set(`${selection.group}:${page.nextCursor}`, position + 1)
    return { ...page, total: group.total }
  } catch {
    return requestJson<unknown>(path)
  }
}

function watchBankConnection() {
  if (watchOnline) return
  watchOnline = true
  window.addEventListener('online', () => {
    const previousRelease = manifest?.release
    manifestExpires = 0
    resetPublicPages()
    void getManifest().then((next) => {
      if (!next || next.release === previousRelease || !previousRelease) window.dispatchEvent(new Event(bankReleaseEvent))
    })
  })
}

export function cachedPublic<T>(path: string): T | undefined {
  const cached = publicPages.get(path)
  if (!cached || typeof window === 'undefined') return
  if (!navigator.onLine || (cached.expiresAt > Date.now() && (!bankSelection(path) || manifestExpires > Date.now()))) {
    return cached.value as T
  }
}

export async function readPublic<T>(path: string): Promise<T> {
  if (new URLSearchParams(path.split('?')[1]).get('random') === '1') return requestJson<T>(path, { cache: 'no-store' })
  const bank = bankSelection(path)
  if (bank) watchBankConnection()
  const cached = cachedPublic<T>(path)
  if (cached !== undefined) return cached
  const existing = publicRequests.get(path)
  if (existing) return existing as Promise<T>

  const epoch = cacheEpoch
  const request = (bank ? readBank(path, bank) : requestJson<T>(path)).then((value) => {
    if (epoch !== cacheEpoch) return value
    publicPages.delete(path)
    publicPages.set(path, { value, expiresAt: Date.now() + 45_000 })
    if (publicPages.size > 24) {
      const oldest = publicPages.keys().next().value
      if (oldest) publicPages.delete(oldest)
    }
    return value
  }).finally(() => {
    if (publicRequests.get(path) === request) publicRequests.delete(path)
  })
  publicRequests.set(path, request)
  return request as Promise<T>
}

export function letter(index: number) {
  return String.fromCharCode(65 + index)
}

export function answerLetters(options: readonly Option[], ids: readonly string[]) {
  return options.flatMap((option, index) => ids.includes(option.id) ? [letter(index)] : []).join('、')
}
