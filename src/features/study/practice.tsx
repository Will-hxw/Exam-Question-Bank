'use client'

import { Fragment, type FormEvent, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { BottomDrawer, Button, StatTile, TextInput } from '@/components/ui'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'
import type { PracticeBootstrap } from '@/server/study-bootstrap'
import { practiceBankPageSize as batchSize, rememberPublicPage, type QuestionPage, questionUrl, readPublic, requestJson, type Topic } from './api'
import { LoadMessage, TopicPicker } from './controls'
import { readStudyPreference, type StudyPreferences, useStudyPreferencesReady, writeStudyPreference } from './preferences'
import { addPracticeBookmark, findPracticeBookmark, identifyPracticeBookmark, practiceHistoryLimit, restorePracticeHistory,
  sameBookmark, type PracticeBookmark, type PracticeDirection, type PracticeHistory } from './practice-history'
import { initialUndonePosition, practiceUndonePreference, stepUndonePosition, type PracticePosition } from './practice-undone'
import { useQuestionStates, useStudySessionContext } from './study-shell'
import { useStudyData } from './use-study-data'
import { PracticeCard, type PracticeAnswer } from './practice-card'

const modes = siteConfig.practiceModes

type Mode = typeof modes[number]['id']
type PracticeSettings = { mode: Mode; topic: string; seed: string; randomOnBank?: boolean }
type BankBootstrap = Promise<PracticeBootstrap | null>

function readSettings(value: unknown, initialSeed: string): PracticeSettings {
  const saved = value as Partial<PracticeSettings> | undefined
  const mode = modes.find(({ id }) => id === saved?.mode)?.id ?? 'topic'
  const topic = typeof saved?.topic === 'string' ? saved.topic : ''
  const seed = typeof saved?.seed === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(saved.seed) ? saved.seed.toLowerCase() : initialSeed
  return { mode, topic, seed, ...(typeof saved?.randomOnBank === 'boolean' ? { randomOnBank: saved.randomOnBank } : {}) }
}

function positionKey(mode: Mode, topic: string) {
  return mode === 'topic' ? `topic:${topic}` : mode
}

function positionPreference(mode: Mode, topic: string, randomOnBank: boolean) {
  return `practice-position:${mode === 'random' && randomOnBank ? 'random-undone' : positionKey(mode, topic)}`
}

function practicePosition(values: StudyPreferences, mode: Mode, topic: string, randomOnBank = false) {
  const value = values[positionPreference(mode, topic, randomOnBank)]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 100000 ? value : null
}

function supportsUndone(mode: Mode) {
  return mode === 'topic' || mode === 'random' || mode === 'sequence'
}

function undonePath(topic: string) {
  return `/api/me/practice-undone${topic ? '?' + new URLSearchParams({ topic }) : ''}`
}

function batchFor(index: number) {
  return { offset: Math.floor(index / batchSize) * batchSize, limit: batchSize }
}

function practicePagePath(mode: Mode, topic: string, { position, seed }: PracticeBookmark) {
  const { offset, limit } = batchFor(position)
  return questionUrl({
    topic: mode === 'topic' ? topic : undefined,
    offset: seed ? undefined : offset,
    limit,
    practice: true,
    status: mode === 'wrong' || mode === 'favorite' ? mode : undefined,
    random: seed,
  })
}

function PracticeSheetPanel({ ordered, index, total, onJump }: {
  ordered: boolean
  index: number
  total: number
  onJump: (value: number) => void
}) {
  const [input, setInput] = useState(String(index + 1))

  function handleJumpSubmit(event: FormEvent) {
    event.preventDefault()
    const n = Number(input)
    if (Number.isSafeInteger(n) && n >= 1 && n <= total) onJump(n - 1)
  }

  if (!ordered || total <= 0) {
    return (
      <p className="m-0 text-xs text-ink-muted">
        {messages.practice.dynamicSequenceHint}
      </p>
    )
  }

  const windowSize = siteConfig.practiceSheetWindowSize
  const start = Math.max(0, Math.min(total - windowSize, Math.floor(index / windowSize) * windowSize))
  const end = Math.min(total, start + windowSize)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta font-semibold">{messages.practice.answerSheet}</span>
        <span className="tabular-nums text-xs text-ink-muted">{index + 1} / {total}</span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: end - start }, (_, offset) => {
          const itemIndex = start + offset
          const current = itemIndex === index
          return (
            <button
              key={itemIndex}
              type="button"
              onClick={() => onJump(itemIndex)}
              className={`sheet-cell ${current ? 'bg-selected-badge text-white' : 'bg-surface text-ink-secondary hover:bg-surface-hover'}`}
            >
              {itemIndex + 1}
            </button>
          )
        })}
      </div>
      <form className="flex items-center gap-2 mt-1" onSubmit={handleJumpSubmit}>
        <TextInput
          type="number"
          inputMode="numeric"
          className="h-10 flex-1 tabular-nums text-xs"
          aria-label={messages.practice.jumpInputAria}
          value={input}
          min={1}
          max={total}
          onChange={(event) => setInput(event.target.value)}
          required
        />
        <Button type="submit" variant="surface" size="sm" className="h-10 rounded-control text-xs shrink-0">
          {messages.practice.jumpAction}
        </Button>
      </form>
    </div>
  )
}

function eligibleBookmarks(positions?: PracticePosition[]) {
  if (!positions) return () => true
  const ids = new Set(positions.map(({ id }) => id))
  const order = new Set(positions.map(({ position }) => position))
  return (entry: PracticeBookmark) => entry.id ? ids.has(entry.id) : !entry.seed && order.has(entry.position)
}

function buildPracticeTrail(
  saved: unknown,
  start: PracticeBookmark,
  onlyUndone: boolean,
  available: PracticePosition[] | undefined,
  undoneSeed: string | undefined,
) {
  const restored = restorePracticeHistory(saved, start)
  const active = restored.entries[restored.cursor]
  const history = { ...restored, filtered: onlyUndone, empty: false }
  if (available && !available.length) return { ...history, empty: true }
  const eligible = eligibleBookmarks(available)
  if (!available || (restored.filtered && !restored.empty) || eligible(active)) return history
  const next = findPracticeBookmark(history, 'next', eligible)
  if (next >= 0) return { ...history, cursor: next }
  const position = initialUndonePosition(available, active.seed ? null : active.position, undoneSeed)
  return position === null ? { ...history, empty: true } : addPracticeBookmark(history, { position }, 'next')
}

function PracticeLayout({ children, rail }: { children: React.ReactNode; rail: React.ReactNode }) {
  const { attempts, stats } = useStudySessionContext()
  const statData = stats.data
  const syncLabel = { pending: '本地已保存，待同步', synced: '云端已同步', error: messages.practice.syncErrorLabel, rejected: messages.practice.syncRejectedLabel, idle: '' }[attempts.status]
  return (
    <div className="study-two-col">
      <div>
        {(syncLabel || stats.error) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary mb-3" role="status">
            {syncLabel && <span>{syncLabel}</span>}
            {attempts.status === 'error' && <Button variant="surface" size="xs" onClick={() => void attempts.flush()}>{messages.practice.retrySync}</Button>}
            {stats.error && <Button variant="surface" size="xs" onClick={stats.retry}>重试统计</Button>}
          </div>
        )}
        {children}
      </div>
      <aside className="study-rail">
        <div role="group" aria-label="练习统计" className="grid grid-cols-3 gap-2.5">
          <StatTile label={messages.common.practicedStat} value={statData?.attempted ?? '—'} />
          <StatTile label={messages.common.wrongStat} value={statData?.wrong ?? '—'} valueClassName="text-wrong-ink" />
          <StatTile label={messages.common.favoriteStat} value={statData?.favorites ?? '—'} />
        </div>
        {rail}
      </aside>
    </div>
  )
}

function PracticeDeck({ mode, topic, topicCount, seed, start, rememberPosition, remaining, bootstrap, rightRailHeader }: {
  mode: Mode; topic: string; topicCount: number; seed: string; start: PracticeBookmark
  rememberPosition: (bookmark: PracticeBookmark) => void
  remaining?: PracticePosition[]
  bootstrap?: BankBootstrap
  rightRailHeader: React.ReactNode
}) {
  const { userId, attempts, personalReads, prefetchQuestionStates, revision } = useStudySessionContext()
  const storageKey = siteConfig.storageKeys.practiceHistory(userId, positionKey(mode, topic))
  const onlyUndone = remaining !== undefined
  const undoneSeed = onlyUndone && mode === 'random' ? seed : undefined
  const attempted = attempts.recentlyAttemptedIds()
  const available = useMemo(() => remaining?.filter(({ id }) => !attempted.has(id)), [attempted, remaining])
  const eligible = eligibleBookmarks(available)
  const hydrated = useStudyPreferencesReady()
  const [userTrail, setTrail] = useState<PracticeHistory | null>(null)
  const trail = useMemo(
    () => userTrail ?? buildPracticeTrail(hydrated ? readStudyPreference(storageKey) : undefined, start, onlyUndone, available, undoneSeed),
    [available, hydrated, onlyUndone, start, storageKey, undoneSeed, userTrail],
  )
  if (hydrated && !userTrail) setTrail(trail)
  const active = trail.entries[trail.cursor]
  const { position: requestedIndex } = active
  const [round, setRound] = useState(0)
  const [answers, setAnswers] = useState<Record<string, PracticeAnswer>>({})
  const [sheetOpen, setSheetOpen] = useState(false)
  const [navDirection, setNavDirection] = useState<'forward' | 'backward' | 'jump'>('jump')
  const refreshed = useRef(new Set<string>())
  const seededBatch = Boolean(active.seed)
  const ordered = mode === 'topic' || mode === 'sequence'
  const status = mode === 'wrong' || mode === 'favorite' ? mode : ''
  const personal = Boolean(status)
  const { offset } = batchFor(requestedIndex)
  const query = trail.empty ? null : practicePagePath(mode, topic, active)
  const initialPage = useMemo(() => bootstrap && query && !personal
    ? Promise.resolve(bootstrap).then((data) => {
      if (data?.page?.path !== query) return null
      rememberPublicPage(query, data.page.data)
      return data.page.data
    }) : undefined, [bootstrap, personal, query])
  const page = useStudyData<QuestionPage>(query, personal ? revision : 0,
    personal ? personalReads : { initial: initialPage })
  const visiblePage = page.data
  const total = (seededBatch ? visiblePage?.questions.length : visiblePage?.total) ?? topicCount
  const inBatch = (personal || ordered) && active.id ? visiblePage?.questions.findIndex(({ id }) => id === active.id) ?? -1 : -1
  const positionPath = ordered && visiblePage && active.id && inBatch < 0
    ? `${siteConfig.api.publicPrefix}questions/${active.id}/position${topic ? '?' + new URLSearchParams({ topic }) : ''}` : null
  const position = useStudyData<{ position: number | null }>(positionPath)
  const relocating = Boolean(positionPath && !position.data)
  const fallbackIndex = personal && visiblePage?.total !== undefined ? Math.min(requestedIndex, Math.max(0, total - 1)) : requestedIndex
  const index = inBatch >= 0 ? offset + inBatch : position.data?.position ?? fallbackIndex
  const question = relocating ? undefined : visiblePage?.questions[seededBatch ? index : index - offset]
  const questionId = question?.id
  const cardKey = question ? `${round}:${active.seed ?? ''}:${index}:${question.id}:${question.contentRevision ?? ''}` : ''
  const answer = answers[cardKey]
  const rejected = answer?.eventId && attempts.rejections[answer.eventId] ? answer.eventId : undefined
  const lastRejection = Object.entries(attempts.rejections).findLast(([, id]) => id === questionId)?.[0] ?? ''
  const states = useQuestionStates(personal ? [] : visiblePage?.questions.map(({ id }) => id) ?? [])
  const activeState = questionId ? states.data?.states[questionId] : null
  const history = useMemo(() => questionId ? identifyPracticeBookmark(trail, questionId) : trail, [trail, questionId])
  const syncPosition = useEffectEvent((bookmark: PracticeBookmark) => {
    if (!sameBookmark(start, bookmark)) rememberPosition(bookmark)
  })

  useEffect(() => {
    if (!hydrated || relocating) return
    writeStudyPreference(storageKey, history)
    if (!history.empty) syncPosition(history.entries[history.cursor])
  }, [history, hydrated, relocating, storageKey])

  const reload = page.reload
  useEffect(() => {
    if (!rejected || refreshed.current.has(rejected)) return
    refreshed.current.add(rejected)
    reload((path) => requestJson<QuestionPage>(path.replace(siteConfig.api.publicPrefix, siteConfig.api.mePrefix), { headers: { [siteConfig.api.accountHeader]: userId } }))
  }, [rejected, reload, userId])

  if (index !== requestedIndex) {
    setTrail({ ...trail, entries: trail.entries.map((entry, at) => at === trail.cursor
      ? { ...entry, position: index, id: position.data?.position === index ? active.id : questionId } : entry) })
  }

  function findNeighbor(direction: PracticeDirection): PracticeBookmark | undefined {
    if (available && question) {
      const target = stepUndonePosition(available, { position: index, id: question.id }, direction, undoneSeed)
      return target === null ? undefined : { position: target, id: available.find(({ position }) => position === target)?.id }
    }
    if (mode === 'random' && !active.seed) return undefined
    const target = index + (direction === 'previous' ? -1 : 1)
    return target >= 0 && target < total ? { position: target, seed: active.seed } : undefined
  }

  const nextIndex = findPracticeBookmark(history, 'next', eligible)
  const previousIndex = findPracticeBookmark(history, 'previous', eligible)
  const ahead = nextIndex >= 0 ? history.entries[nextIndex] : findNeighbor('next')
  const behind = previousIndex >= 0 ? history.entries[previousIndex] : findNeighbor('previous')
  const canNext = Boolean(ahead) || (!onlyUndone && mode === 'random')
  const warmPaths = question
    ? [...new Set([ahead, behind].flatMap((entry) => entry ? [practicePagePath(mode, topic, entry)] : []))]
      .filter((path) => path !== query).join('\n') : ''

  useEffect(() => {
    if (!warmPaths) return
    const timer = setTimeout(() => {
      if (!navigator.onLine || document.hidden) return
      for (const path of warmPaths.split('\n')) {
        if (personal) void personalReads.load(path).catch(() => {})
        else void readPublic<QuestionPage>(path).then(({ questions }) => {
          if (questions.length) return prefetchQuestionStates(questions.map(({ id }) => id))
        }).catch(() => {})
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [personal, personalReads, prefetchQuestionStates, warmPaths])

  function move(next: typeof history) {
    setTrail(next)
    writeStudyPreference(storageKey, next)
    const bookmark = next.entries[next.cursor]
    if (!sameBookmark(start, bookmark)) rememberPosition(bookmark)
  }

  function jump(next: number) {
    setSheetOpen(false)
    setNavDirection('jump')
    move(addPracticeBookmark(history, { position: next, seed: active.seed }, 'jump'))
  }

  function navigate(direction: PracticeDirection) {
    setNavDirection(direction === 'previous' ? 'backward' : 'forward')
    const recorded = direction === 'previous' ? previousIndex : nextIndex
    if (recorded >= 0) {
      move({ ...history, cursor: recorded, empty: false })
      return
    }
    const target = direction === 'previous' ? behind : ahead
    if (target) {
      move(addPracticeBookmark(history, target, direction))
    } else if (!available && direction === 'next' && mode === 'random') {
      move(addPracticeBookmark(history, { position: 0, seed: crypto.randomUUID() }, 'next'))
      setRound((previous) => previous + 1)
      setAnswers({})
    }
  }

  const fallback = mode === 'wrong'
    ? messages.practice.wrongModeFallback(total)
    : mode === 'favorite'
      ? messages.practice.favoriteModeFallback(total)
      : messages.practice.randomModeFallback

  return (
    <>
      <PracticeLayout rail={<>
        {rightRailHeader}
        <PracticeSheetPanel key={index} ordered={ordered} index={index} total={total} onJump={jump} />
      </>}>
        {!question ? (
          <>
            <LoadMessage
              loading={page.loading || position.loading}
              error={page.error ?? position.error}
              retry={position.error ? position.retry : page.retry}
              empty={trail.empty
                ? messages.practice.emptyUndone
                : mode === 'wrong'
                  ? messages.practice.emptyWrong
                  : mode === 'favorite'
                    ? messages.practice.emptyFavorite
                    : messages.practice.emptyDefault}
            />
            {trail.empty && ordered && total > 0 && (
              <Button variant="surface" size="md" className="lg:hidden" onClick={() => setSheetOpen(true)}>{messages.practice.answerSheet}</Button>
            )}
            {index > 0 && !trail.empty && (
              <div className="mt-4 flex justify-center">
                <Button variant="surface" size="md" className="h-10 px-5 rounded-control text-sm" onClick={() => jump(0)}>
                  {messages.practice.backToFirst}
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <PracticeCard
              key={`${cardKey}:${lastRejection}`}
              question={question}
              answer={rejected ? undefined : answer}
              record={(nextAnswer) => setAnswers((previous) => Object.fromEntries([
                ...Object.entries(previous).filter(([key]) => key !== cardKey),
                [cardKey, nextAnswer],
              ].slice(-practiceHistoryLimit)))}
              resetRecord={() => setAnswers((previous) => {
                const next = { ...previous }
                delete next[cardKey]
                return next
              })}
              mode={mode}
              index={index}
              total={total}
              fallback={fallback}
              previous={behind ? () => navigate('previous') : null}
              next={canNext ? () => navigate('next') : null}
              attempted={Boolean(attempted.has(question.id) || (activeState?.attempted ?? question.attempted))}
              favorite={activeState?.isFavorite ?? question.isFavorite}
              wrongMode={mode === 'wrong'}
              onRemoved={() => jump(Math.min(index, Math.max(0, total - 2)))}
              onOpenSheet={() => setSheetOpen(true)}
              direction={navDirection}
            />
            {onlyUndone && !canNext && <p className="mt-3 text-meta text-ink-secondary" role="status">{available?.length ? messages.practice.onlyCurrentUndone : messages.practice.allDoneInRange}</p>}
            {rejected && <p className="mt-3 text-meta text-wrong-ink" role="status">{messages.practice.rejectedNotice}</p>}
            {states.error && !personal && (
              <p className="mt-3 text-meta text-wrong-ink" role="alert">
                {messages.practice.statesLoadError}{' '}
                <Button variant="surface" size="xs" onClick={states.retry}>{messages.common.retry}</Button>
              </p>
            )}
          </>
        )}
      </PracticeLayout>

      {/* Mobile answer sheet bottom drawer */}
      <BottomDrawer
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={messages.practice.answerSheet}
        closeLabel={messages.common.close}
      >
        <PracticeSheetPanel key={index} ordered={ordered} index={index} total={total} onJump={jump} />
      </BottomDrawer>
    </>
  )
}

function PracticeContent({ bootstrap, initialSeed: serverSeed }: { bootstrap?: BankBootstrap; initialSeed?: string }) {
  const { topics: shellTopics, preferences, personalReads, revision } = useStudySessionContext()
  const initialTopics = useMemo(() => bootstrap
    ? Promise.resolve(bootstrap).then((data) => data ? { topics: data.topics } : null) : undefined, [bootstrap])
  const bootTopics = useStudyData<{ topics: Topic[] }>(initialTopics ? siteConfig.api.topics : null, 0, { initial: initialTopics })
  const topics = bootTopics.data ? bootTopics : shellTopics
  const [initialSeed] = useState(() => serverSeed ?? crypto.randomUUID())
  const settings = readSettings(preferences.values.practice, initialSeed)
  const { mode, topic: chosenTopic, seed } = settings
  const entries = topics.data?.topics ?? []
  const topic = entries.find((entry) => entry.id === chosenTopic) ?? entries.find((entry) => entry.count > 0) ?? entries[0]
  const topicId = topic?.id ?? ''
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)
  const topicCount = mode === 'topic' ? topic?.count ?? 0 : total
  const onlyUndone = preferences.values[practiceUndonePreference] === true
  const filtering = onlyUndone && supportsUndone(mode)
  const randomOnBank = mode === 'random' && (settings.randomOnBank
    ?? (filtering && practicePosition(preferences.values, mode, topicId, true) !== null))
  const position = practicePosition(preferences.values, mode, topicId, randomOnBank)
  const pastEnd = (mode === 'topic' || mode === 'sequence') && topicCount > 0 && (position ?? 0) >= topicCount
  const boundedPosition = pastEnd ? 0 : position ?? 0
  const start: PracticeBookmark = mode === 'random' && !randomOnBank
    ? { position: Math.min(boundedPosition, batchSize - 1), seed } : { position: boundedPosition }
  const range = mode === 'topic' ? topicId : ''
  const remaining = useStudyData<{ positions: PracticePosition[] }>(
    filtering && (mode !== 'topic' || topicId) ? undonePath(range) : null, revision, { ...personalReads, keepPreviousData: true },
  )

  function saveSettings(next: PracticeSettings) {
    preferences.save({ practice: next })
  }

  function warmPath(next: Mode) {
    if (onlyUndone && supportsUndone(next)) return undonePath(next === 'topic' ? topicId : '')
    const onBank = next === 'random' && settings.randomOnBank === true
    return practicePagePath(next, topicId, {
      position: practicePosition(preferences.values, next, topicId, onBank) ?? 0,
      seed: next === 'random' && !onBank ? seed : undefined,
    })
  }

  function warmMode(next: Mode) {
    if (!navigator.onLine) return
    const path = warmPath(next)
    void (path.startsWith(siteConfig.api.mePrefix) ? personalReads.load(path) : readPublic(path)).catch(() => {})
  }

  function rememberPosition(bookmark: PracticeBookmark) {
    const nextSeed = bookmark.seed ?? seed
    const nextRandomOnBank = mode === 'random' ? !bookmark.seed : settings.randomOnBank
    const updateSettings = nextSeed !== seed || nextRandomOnBank !== settings.randomOnBank || !preferences.values.practice
    preferences.save({
      [positionPreference(mode, topicId, nextRandomOnBank === true)]: bookmark.position,
      ...(updateSettings ? { practice: { ...settings, seed: nextSeed, randomOnBank: nextRandomOnBank } } : {}),
    })
  }

  const rightRailHeader = (
    <div className="p-4 rounded-option bg-surface flex flex-col gap-3">
      <div className="text-xs font-medium text-ink-muted">{messages.practice.modeAndTopicsTitle}</div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={messages.practice.modeGroupAria}>
        {modes.map((entry) => (
          <Fragment key={entry.id}>
            <button
              type="button"
              className={`tactile h-8 px-3 rounded-micro text-meta font-medium ${mode === entry.id ? 'bg-selected-fill text-selected-ink' : 'bg-canvas text-ink-primary hover:bg-surface-hover'}`}
              aria-pressed={mode === entry.id}
              onPointerEnter={() => warmMode(entry.id)}
              onFocus={() => warmMode(entry.id)}
              onPointerDown={() => warmMode(entry.id)}
              onClick={() => { if (mode !== entry.id) saveSettings({ ...settings, mode: entry.id }) }}
            >
              {entry.label}
            </button>
            {entry.id === 'sequence' && (
              <button
                type="button"
                className={`tactile h-8 px-3 rounded-micro text-meta font-medium ${onlyUndone ? 'bg-selected-fill text-selected-ink' : 'bg-canvas text-ink-primary hover:bg-surface-hover'}`}
                aria-pressed={onlyUndone}
                onClick={() => preferences.save({ [practiceUndonePreference]: !onlyUndone })}
              >
                {messages.shell.onlyUndone}
              </button>
            )}
          </Fragment>
        ))}
      </div>
      {mode === 'topic' && topic && (
        <TopicPicker topics={entries} value={topic.id} onChange={(value) => saveSettings({ ...settings, topic: value })} />
      )}
    </div>
  )

  const missingTopics = mode === 'topic' && !topic
  if (missingTopics || (filtering && !remaining.data)) {
    const state = missingTopics ? topics : remaining
    return <PracticeLayout rail={rightRailHeader}>
      <LoadMessage error={state.error} loading={state.loading} retry={state.retry} empty={missingTopics ? messages.practice.emptyTopics : undefined} />
    </PracticeLayout>
  }

  return (
    <PracticeDeck
      key={positionKey(mode, topicId) + (filtering ? ':filtered' : '')}
      mode={mode}
      topic={range}
      topicCount={topicCount}
      seed={seed}
      start={start}
      remaining={filtering ? remaining.data?.positions : undefined}
      rememberPosition={rememberPosition}
      bootstrap={bootstrap}
      rightRailHeader={rightRailHeader}
    />
  )
}

export function Practice({ bootstrap, initialSeed }: { bootstrap?: BankBootstrap; initialSeed?: string }) {
  const { preferences } = useStudySessionContext()
  return preferences.ready ? <PracticeContent bootstrap={bootstrap} initialSeed={initialSeed} /> : <LoadMessage loading />
}
