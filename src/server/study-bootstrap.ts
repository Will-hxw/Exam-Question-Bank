import 'server-only'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cache } from 'react'
import { practiceBankPageSize, questionUrl, type QuestionPage, type Topic, validManifest, validPage } from '@/features/study/api'
import { practiceUndonePreference } from '@/features/study/practice-undone'
import { bankRelease } from './content'
import { readStudyPreferences, studyStats } from './learning'

export type PracticeBootstrap = { topics: Topic[]; page?: { path: string; data: QuestionPage } }

const bankRoot = join(process.cwd(), 'public', 'bank')
const shardPattern = /^\/bank\/pages\/([a-f0-9]{64})\.json$/
const pageSize = practiceBankPageSize

export const initialStudyStats = cache((userId: string) => studyStats(userId).catch(() => null))
export const initialStudyPreferences = cache((userId: string) => readStudyPreferences(userId).catch(() => null))

async function releaseManifest() {
  try {
    const value: unknown = JSON.parse(await readFile(join(bankRoot, 'manifest.json'), 'utf8'))
    return validManifest(value) ? value : null
  } catch {
    return null
  }
}

export async function initialPracticeBank(userId: string): Promise<PracticeBootstrap | null> {
  const [manifest, preferences, active] = await Promise.all([
    releaseManifest(), initialStudyPreferences(userId), bankRelease().catch(() => null),
  ])
  if (!manifest || active?.release !== manifest.release) return null
  const topics = manifest.topics
  if (!preferences) return { topics }
  const practice = preferences.practice as { mode?: string; topic?: string } | undefined
  const mode = practice?.mode ?? 'topic'
  if (preferences[practiceUndonePreference] === true || (mode !== 'topic' && mode !== 'sequence')) return { topics }

  const selected = topics.find(({ id }) => id === practice?.topic) ?? topics.find(({ count }) => count > 0) ?? topics[0]
  const topic = mode === 'topic' ? selected?.id : undefined
  const group = topic ?? '_all'
  const bank = manifest.groups[group]
  if (!bank?.total) return { topics }
  const saved = preferences[`practice-position:${topic ? `topic:${topic}` : 'sequence'}`]
  const index = typeof saved === 'number' && Number.isSafeInteger(saved) && saved >= 0 && saved < bank.total ? saved : 0
  const pageIndex = Math.floor(index / pageSize)
  const offset = pageIndex * pageSize
  const digest = shardPattern.exec(bank.pages[pageIndex])?.[1]
  if (!digest) return { topics }

  try {
    const bytes = await readFile(join(bankRoot, 'pages', `${digest}.json`))
    if (createHash('sha256').update(bytes).digest('hex') !== digest) return { topics }
    const data: unknown = JSON.parse(bytes.toString('utf8'))
    if (validPage(data, Math.min(pageSize, bank.total - offset), group, pageIndex === bank.pages.length - 1)) {
      return { topics, page: { path: questionUrl({ topic, offset, limit: pageSize, practice: true }), data: { ...data, total: bank.total } } }
    }
  } catch { /* The client can load the question batch from the CDN or the public API. */ }
  return { topics }
}
