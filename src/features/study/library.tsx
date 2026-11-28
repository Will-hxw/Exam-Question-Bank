'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Badge, Button, CollapsePanel, TextInput } from '@/components/ui'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'
import { answerLetters, cachedQuestionExplanation, type Explanation, letter, type Question, type QuestionPage, type QuestionState, type QuestionType, readPublic, type Status } from './api'
import { ChoicePicker, ExplanationPanel, LoadMessage, TopicPicker } from './controls'
import { libraryPageSizes, libraryPath, readLibraryView, type LibraryList, type LibraryView } from './preferences'
import { useQuestionFavorite, useQuestionStates, useStudySessionContext } from './study-shell'
import { useDebouncedSearch, useStudyData } from './use-study-data'

const questionTypes: readonly { value: QuestionType | ''; label: string }[] = messages.library.typeOptions
const statuses: readonly { value: Status | ''; label: string }[] = messages.library.statusOptions
const pageSizes = libraryPageSizes.map((value) => ({ value, label: messages.library.pageSizeLabel(value) }))

function explanationPath(id: string) {
  return siteConfig.api.explanation(id)
}

function warmExplanation(question: Question) {
  if (navigator.onLine && !cachedQuestionExplanation(question)) void readPublic<Explanation>(explanationPath(question.id)).catch(() => {})
}

function QuestionRow({ question, state, list, index = 0 }: { question: Question; state?: Partial<QuestionState>; list: 'all' | 'wrong' | 'favorite'; index?: number }) {
  const { removeWrong } = useStudySessionContext()
  const favoriteControl = useQuestionFavorite(question.id, state?.isFavorite ?? question.isFavorite)
  const [showAnswer, setShowAnswer] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const cached = showAnswer ? cachedQuestionExplanation(question) : undefined
  const explanation = useStudyData<Explanation>(showAnswer && !cached ? explanationPath(question.id) : null)
  const explanationData = cached ?? explanation.data
  const attempted = state?.attempted ?? question.attempted ?? false

  async function clearWrong() {
    setSaving(true)
    setError('')
    try {
      await removeWrong(question.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.library.removeWrongError)
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className={`p-4.5 lg:p-5 rounded-option bg-surface flex flex-col gap-3 animate-option-in stagger-${Math.min(index, 6)}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="canvas">{question.type === 'single' ? messages.common.singleChoice : messages.common.multipleChoice}</Badge>
          {attempted && <Badge tone="correct" size="status">{messages.common.answered}</Badge>}
        </div>
      </div>

      <p className="font-serif m-0 text-item-stem font-semibold text-ink-primary">{question.stem}</p>

      <div className="flex flex-col gap-1.5">
        {question.options.map((option, index) => {
          const hit = Boolean(explanationData?.answerIds.includes(option.id))
          return (
            <div
              key={option.id}
              className={`px-3 py-2 rounded-micro text-sm leading-relaxed flex items-baseline gap-2 ${hit ? 'bg-correct-fill text-correct-ink font-medium' : 'bg-canvas text-ink-body'}`}
            >
              <span className="font-semibold tabular-nums shrink-0">{letter(index)}</span>
              <span>{option.text}</span>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button
          type="button"
          className="tactile h-8.5 px-3.5 rounded-micro text-meta font-medium bg-canvas text-ink-primary hover:bg-surface-hover"
          aria-expanded={showAnswer}
          data-explanation-id={question.id}
          onPointerEnter={(event) => { if (event.pointerType === 'mouse') warmExplanation(question) }}
          onFocus={() => warmExplanation(question)}
          onPointerDown={() => warmExplanation(question)}
          onClick={() => { setShowAnswer(!showAnswer); setExpanded(false) }}
        >
          {showAnswer ? messages.library.hideAnswer : messages.library.showAnswer}
        </button>

        <button
          type="button"
          className={`tactile h-8.5 px-3.5 rounded-micro text-meta font-medium ${favoriteControl.favorite ? 'bg-missed-fill text-missed-ink' : 'bg-canvas text-ink-primary hover:bg-surface-hover'}`}
          aria-pressed={favoriteControl.favorite}
          aria-busy={favoriteControl.pending || undefined}
          onClick={favoriteControl.toggle}
        >
          {favoriteControl.favorite ? messages.common.favorited : messages.common.favorite}
        </button>

        {list === 'wrong' && (
          <button
            type="button"
            className="tactile h-8.5 px-3.5 rounded-micro text-meta font-medium bg-canvas text-wrong-ink hover:bg-wrong-fill"
            disabled={saving}
            onClick={() => void clearWrong()}
          >
            {messages.common.removeFromWrong}
          </button>
        )}

        {explanationData && (
          <button
            type="button"
            className="tactile h-8.5 px-3.5 rounded-micro text-meta font-medium bg-canvas text-ink-secondary disabled:opacity-45"
            aria-expanded={expanded && attempted}
            disabled={!attempted}
            title={!attempted ? messages.library.expandHint : undefined}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? messages.common.collapseExplanation : messages.common.expandExplanation}
          </button>
        )}
      </div>

      {favoriteControl.error && <p className="m-0 text-xs text-wrong-ink" role="alert">{favoriteControl.error}</p>}
      {error && <p className="m-0 text-xs text-wrong-ink" role="alert">{error}</p>}
      {explanation.loading && <p className="m-0 text-xs text-ink-muted" role="status">{messages.common.loadingAnswer}</p>}
      {explanation.error && (
        <div className="text-xs text-wrong-ink flex items-center gap-2" role="alert">
          <span>{explanation.error}</span>
          <Button variant="surface" size="xs" className="bg-canvas text-ink-primary" onClick={explanation.retry}>{messages.common.retry}</Button>
        </div>
      )}
      {explanationData && (
        <p className="m-0 text-control text-ink-secondary">
          {messages.common.correctAnswer} <span className="font-semibold tabular-nums text-correct-ink ml-1">{answerLetters(explanationData.options, explanationData.answerIds)}</span>
        </p>
      )}
      {attempted && explanationData && (
        <CollapsePanel open={expanded}>
          <div className="pt-2">
            <ExplanationPanel content={explanationData} />
          </div>
        </CollapsePanel>
      )}
    </article>
  )
}

function QuestionList({ view, q, status, list, initialPage, onPageChange, onLimitChange }: {
  view: LibraryView; q: string; status: Status | ''; list: LibraryList
  initialPage?: { path: string; data: QuestionPage } | null
  onPageChange: (index: number) => void; onLimitChange: (limit: number) => void
}) {
  const currentPath = libraryPath(list, view, q)
  const [loaded, setLoaded] = useState<{ index: number; data: QuestionPage } | undefined>(() =>
    !status && initialPage?.path === currentPath ? { index: view.page, data: initialPage.data } : undefined,
  )
  const scrollOnPage = useRef<number | null>(null)
  const rows = useRef<HTMLDivElement>(null)
  const { revision, personalReads } = useStudySessionContext()
  const { page: pageIndex, limit } = view
  const page = useStudyData<QuestionPage>(
    currentPath, status ? revision : 0,
    status ? personalReads : { initial: initialPage?.path === currentPath ? initialPage.data : undefined },
  )
  const total = page.data?.total ?? loaded?.data.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const outOfRange = Boolean(page.data && pageIndex >= pageCount)
  useEffect(() => {
    if (outOfRange) onPageChange(pageCount - 1)
  }, [onPageChange, outOfRange, pageCount])
  if (page.data && !outOfRange && loaded?.data !== page.data) {
    setLoaded({ index: pageIndex, data: page.data })
  }
  const currentIndex = Math.min(loaded?.index ?? 0, pageCount - 1)
  const questions = loaded?.data.questions ?? []
  const states = useQuestionStates(status ? [] : questions.map((question) => question.id))
  const nextPage = page.data && currentIndex + 1 < pageCount ? libraryPath(list, { ...view, page: currentIndex + 1 }, q) : null

  function warmPage(index: number) {
    if (index < 0 || index >= pageCount || index === pageIndex || !navigator.onLine) return
    const path = libraryPath(list, { ...view, page: index }, q)
    void (status ? personalReads.load(path) : readPublic(path)).catch(() => {})
  }

  useEffect(() => {
    if (!nextPage) return
    const timer = setTimeout(() => {
      if (navigator.onLine && !document.hidden) void (status ? personalReads.load(nextPage) : readPublic(nextPage)).catch(() => {})
    }, siteConfig.timings.libraryPrefetchMs)
    return () => clearTimeout(timer)
  }, [nextPage, personalReads, status])

  useEffect(() => {
    const buttons = rows.current?.querySelectorAll<HTMLElement>('[data-explanation-id]')
    if (!buttons?.length || !loaded) return
    const items = new Map(loaded.data.questions.map((question) => [question.id, question]))
    const pending = new Map<Element, ReturnType<typeof setTimeout>>()
    const observer = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        clearTimeout(pending.get(target))
        pending.delete(target)
        if (!isIntersecting) continue
        const id = (target as HTMLElement).dataset.explanationId
        const question = id ? items.get(id) : undefined
        if (question) pending.set(target, setTimeout(() => {
          observer.unobserve(target)
          pending.delete(target)
          if (!document.hidden) warmExplanation(question)
        }, 500))
      }
    })
    buttons.forEach((button) => observer.observe(button))
    return () => {
      observer.disconnect()
      pending.forEach((timer) => clearTimeout(timer))
    }
  }, [loaded])

  useLayoutEffect(() => {
    const target = scrollOnPage.current
    if (target === null || loaded?.index !== target || pageIndex !== target) return
    scrollOnPage.current = null
    window.scrollTo(0, 0)
  }, [loaded, pageIndex])

  function move(index: number) {
    if (page.loading) return
    scrollOnPage.current = index
    if (index === pageIndex) page.retry()
    else onPageChange(index)
  }

  return (
    <div className="flex flex-col gap-4">
      {loaded && (
        <p className="m-0 text-xs font-medium text-ink-muted tabular-nums">
          {messages.library.totalMatched(loaded.data.total)}
        </p>
      )}
      {questions.length === 0 ? (
        <LoadMessage loading={page.loading} error={page.error} retry={page.retry} />
      ) : (
        <div className="flex flex-col gap-3.5" aria-busy={page.loading} ref={rows}>
          {questions.map((question, index) => (
            <QuestionRow key={question.id} question={question} state={states.data?.states[question.id]} list={list} index={index} />
          ))}
        </div>
      )}
      {questions.length > 0 && page.error && (
        <p className="m-0 text-meta text-wrong-ink" role="alert">
          {page.error}{' '}
          <Button variant="surface" size="xs" onClick={page.retry}>{messages.common.retry}</Button>
        </p>
      )}
      {states.error && (
        <p className="m-0 text-meta text-wrong-ink" role="alert">
          {messages.library.statesLoadError}{' '}
          <Button variant="surface" size="xs" onClick={states.retry}>{messages.common.retry}</Button>
        </p>
      )}
      {loaded && total > 0 && (
        <nav className="pt-3 flex items-center justify-between gap-3 flex-wrap" aria-label={messages.library.paginationAria}>
          <div className="flex items-center gap-2">
            <Button
              variant="surface"
              size="md"
              className="h-10"
              disabled={page.loading || currentIndex === 0}
              onPointerEnter={() => warmPage(currentIndex - 1)}
              onFocus={() => warmPage(currentIndex - 1)}
              onClick={() => move(currentIndex - 1)}
            >
              {messages.library.prevPage}
            </Button>
            <output className="tabular-nums text-meta font-medium text-ink-secondary px-2" aria-label={messages.library.pageCountAria}>
              {currentIndex + 1} / {pageCount}
            </output>
            <Button
              variant="surface"
              size="md"
              className="h-10"
              disabled={page.loading || currentIndex + 1 >= pageCount}
              onPointerEnter={() => warmPage(currentIndex + 1)}
              onFocus={() => warmPage(currentIndex + 1)}
              onClick={() => move(currentIndex + 1)}
            >
              {messages.library.nextPage}
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-secondary">
            <span>{messages.library.perPageLabel}</span>
            <ChoicePicker entries={pageSizes} value={limit} fallback={messages.library.pageSizeLabel(limit)} label={messages.library.perPageLabel} alignEnd onChange={onLimitChange} />
          </div>
          {page.loading && currentIndex !== pageIndex && (
            <p className="m-0 text-xs text-ink-muted w-full" role="status">
              {messages.library.loadingPage(pageIndex + 1)}
            </p>
          )}
        </nav>
      )}
    </div>
  )
}

function LibraryContent({ list, initialPage }: { list: LibraryList; initialPage?: { path: string; data: QuestionPage } | null }) {
  const { topics, stats, preferences } = useStudySessionContext()
  const key = `library:${list}`
  const view = readLibraryView(preferences.values[key])
  const { search, type, topic, status } = view
  const q = useDebouncedSearch(search)
  const filter = list === 'all' ? status : list
  const filterBy = (change: Partial<LibraryView>) => preferences.save({ [key]: { page: 0, ...change } })
  const title = messages.library.titles[list]

  return (
    <div className="max-w-library mx-auto flex flex-col gap-5 animate-view-enter">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="font-serif m-0 text-page-title font-bold">{title}</h1>
        {list !== 'all' && stats.data && (
          <span className="tabular-nums text-meta font-medium text-ink-secondary">
            {messages.library.collectionSummary(list === 'wrong' ? stats.data.wrong : stats.data.favorites, list)}
          </span>
        )}
      </div>

      {list === 'all' && (
        <TextInput
          type="search"
          placeholder={messages.library.searchPlaceholder}
          maxLength={siteConfig.limits.searchInputMax}
          value={search}
          onChange={(event) => filterBy({ search: event.target.value })}
          aria-label={messages.library.searchAria}
        />
      )}

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-ink-muted w-9 shrink-0">{messages.library.topicLabel}</span>
          <TopicPicker topics={topics.data?.topics ?? []} value={topic} allowAll onChange={(value) => filterBy({ topic: value })} />
          {topics.error && (
            <Button variant="surface" size="sm" onClick={topics.retry}>{messages.library.retryTopics}</Button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={messages.library.typeFilterAria}>
          <span className="text-xs font-medium text-ink-muted w-9 shrink-0">{messages.library.typeLabel}</span>
          {questionTypes.map((entry) => {
            const active = entry.value === type
            return (
              <Button
                key={entry.label}
                variant={active ? 'cta' : 'surface'}
                size="sm"
                aria-pressed={active}
                onClick={() => filterBy({ type: entry.value })}
              >
                {entry.label}
              </Button>
            )
          })}
        </div>

        {list === 'all' && (
          <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={messages.library.statusFilterAria}>
            <span className="text-xs font-medium text-ink-muted w-9 shrink-0">{messages.library.statusLabel}</span>
            {statuses.map((entry) => {
              const active = entry.value === status
              return (
                <Button
                  key={entry.label}
                  variant={active ? 'selected' : 'surface'}
                  size="sm"
                  aria-pressed={active}
                  onClick={() => filterBy({ status: entry.value })}
                >
                  {entry.label}
                </Button>
              )
            })}
          </div>
        )}
      </div>

      <QuestionList
        key={JSON.stringify([topic, type, q, filter])}
        view={view}
        q={q}
        status={filter}
        list={list}
        initialPage={initialPage}
        onPageChange={(index) => filterBy({ page: index })}
        onLimitChange={(size) => filterBy({ limit: size })}
      />
    </div>
  )
}

export function Library({ list, initialPage }: { list: LibraryList; initialPage?: { path: string; data: QuestionPage } | null }) {
  const { preferences } = useStudySessionContext()
  return preferences.ready ? <LibraryContent list={list} initialPage={initialPage} /> : <LoadMessage loading />
}
