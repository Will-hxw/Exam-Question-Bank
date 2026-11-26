'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { answerLetters, cachedQuestionExplanation, type Explanation, letter, type Question, type QuestionPage, type QuestionState, type QuestionType, readPublic, type Status } from './api'
import { ChoicePicker, ExplanationPanel, LoadMessage, TopicPicker } from './controls'
import { libraryPageSizes, libraryPath, readLibraryView, type LibraryList, type LibraryView } from './preferences'
import { useQuestionFavorite, useQuestionStates, useStudySessionContext } from './study-shell'
import { useDebouncedSearch, useStudyData } from './use-study-data'

const questionTypes: { value: QuestionType | ''; label: string }[] = [
  { value: '', label: '全部' }, { value: 'single', label: '单选' }, { value: 'multiple', label: '多选' },
]
const statuses: { value: Status | ''; label: string }[] = [
  { value: '', label: '全部' }, { value: 'undone', label: '未做' }, { value: 'done', label: '已做' },
  { value: 'wrong', label: '错题' }, { value: 'favorite', label: '收藏' },
]
const pageSizes = libraryPageSizes.map((value) => ({ value, label: `${value} 题` }))

function explanationPath(id: string) {
  return `/api/public/questions/${id}/explanation`
}

function warmExplanation(question: Question) {
  if (navigator.onLine && !cachedQuestionExplanation(question)) void readPublic<Explanation>(explanationPath(question.id)).catch(() => {})
}

function QuestionRow({ question, state, list }: { question: Question; state?: Partial<QuestionState>; list: 'all' | 'wrong' | 'favorite' }) {
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
      setError(cause instanceof Error ? cause.message : '无法更新错题，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return <article className="list-item">
    <div className="q-header">
      <span className={`q-type ${question.type}`}>{question.type === 'single' ? '单选题' : '多选题'}</span>
      {attempted && <span className="done-badge">✓ 已答</span>}
    </div>
    <p className="q-text">{question.stem}</p>
    <div className="list-options">
      {question.options.map((option, index) => <span key={option.id}
        className={`opt-line${explanationData?.answerIds.includes(option.id) ? ' answer-highlight' : ''}`}>{letter(index)}. {option.text}</span>)}
    </div>
    <div className="list-actions">
      <button type="button" aria-expanded={showAnswer} data-explanation-id={question.id}
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') warmExplanation(question) }}
        onFocus={() => warmExplanation(question)} onPointerDown={() => warmExplanation(question)}
        onClick={() => { setShowAnswer(!showAnswer); setExpanded(false) }}>
        {showAnswer ? '隐藏答案' : '显示答案'}
      </button>
      <button type="button" aria-pressed={favoriteControl.favorite} aria-busy={favoriteControl.pending || undefined} onClick={favoriteControl.toggle}>
        {favoriteControl.favorite ? '取消收藏' : '收藏'}
      </button>
      {list === 'wrong' && <button type="button" disabled={saving} onClick={() => void clearWrong()}>移出错题集</button>}
      {explanationData && <button type="button" aria-expanded={expanded && attempted} disabled={!attempted}
        title={!attempted ? '作答后可展开解析' : undefined} onClick={() => setExpanded(!expanded)}>{expanded ? '收起解析' : '展开解析'}</button>}
    </div>
    {favoriteControl.error && <p className="study-message error" role="alert">{favoriteControl.error}</p>}
    {error && <p className="study-message error" role="alert">{error}</p>}
    {explanation.loading && <p className="study-message" role="status">加载答案中…</p>}
    {explanation.error && <div className="study-message error" role="alert">{explanation.error} <button className="btn btn-sm" type="button" onClick={explanation.retry}>重试</button></div>}
    {explanationData && <p className="answer-reveal">答案：<span>{answerLetters(explanationData.options, explanationData.answerIds)}</span></p>}
    {attempted && expanded && explanationData && <ExplanationPanel content={explanationData} />}
  </article>
}

function QuestionList({ view, q, status, list, onPageChange, onLimitChange }: {
  view: LibraryView; q: string; status: Status | ''; list: LibraryList
  onPageChange: (index: number) => void; onLimitChange: (limit: number) => void
}) {
  const [loaded, setLoaded] = useState<{ index: number; data: QuestionPage }>()
  const scrollOnPage = useRef<number | null>(null)
  const rows = useRef<HTMLDivElement>(null)
  const { revision, personalReads } = useStudySessionContext()
  const { page: pageIndex, limit } = view
  const page = useStudyData<QuestionPage>(
    libraryPath(list, view, q), status ? revision : 0, status ? personalReads : undefined,
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
    }, 400)
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
    if (list === 'all') scrollOnPage.current = index
    if (index === pageIndex) page.retry()
    else onPageChange(index)
  }

  return <>
    {loaded && <p className="stats-bar">{loaded.data.total} 道符合条件的题目</p>}
    {questions.length === 0 ? <LoadMessage loading={page.loading} error={page.error} retry={page.retry} /> : (
      <div aria-busy={page.loading} ref={rows}>{questions.map((question) => <QuestionRow key={question.id} question={question}
        state={states.data?.states[question.id]} list={list} />)}</div>
    )}
    {questions.length > 0 && page.error && <p className="study-message error" role="alert">
      {page.error} <button type="button" className="btn btn-sm" onClick={page.retry}>重试</button>
    </p>}
    {states.error && <p className="study-message error" role="alert">个人状态加载失败。 <button type="button" className="btn btn-sm" onClick={states.retry}>重试</button></p>}
    {loaded && total > 0 && <nav className="study-pagination" aria-label="题库分页">
      <button type="button" className="btn btn-sm nav-step" disabled={page.loading || currentIndex === 0}
        onPointerEnter={() => warmPage(currentIndex - 1)} onFocus={() => warmPage(currentIndex - 1)}
        onClick={() => move(currentIndex - 1)}>上一页</button>
      <output className="pagination-position" aria-label="当前页 / 总页数">{currentIndex + 1}/{pageCount}</output>
      <button type="button" className="btn btn-sm nav-step" disabled={page.loading || currentIndex + 1 >= pageCount}
        onPointerEnter={() => warmPage(currentIndex + 1)} onFocus={() => warmPage(currentIndex + 1)}
        onClick={() => move(currentIndex + 1)}>下一页</button>
      {list === 'all' && <div className="pagination-size"><span>每页题量</span>
        <ChoicePicker entries={pageSizes} value={limit} fallback={`${limit} 题`} label="每页题量" alignEnd onChange={onLimitChange} />
      </div>}
      <p className="pagination-loading" role="status">
        {page.loading && currentIndex !== pageIndex ? `正在加载第 ${pageIndex + 1} 页…` : ''}
      </p>
    </nav>}
  </>
}

function LibraryContent({ list }: { list: LibraryList }) {
  const { topics, stats, preferences } = useStudySessionContext()
  const key = `library:${list}`
  const view = readLibraryView(preferences.values[key])
  const { search, type, topic, status } = view
  const q = useDebouncedSearch(search)
  const filter = list === 'all' ? status : list
  const filterBy = (change: Partial<LibraryView>) => preferences.save({ [key]: { page: 0, ...change } })

  return <>
    {list === 'all' && <input className="search-box" type="search" placeholder="搜索题干或选项…" maxLength={100} value={search}
      onChange={(event) => filterBy({ search: event.target.value })} aria-label="搜索题目" />}
    {list !== 'all' && stats.data && <p className="stats-bar">共 {list === 'wrong' ? stats.data.wrong : stats.data.favorites} 道{list === 'wrong' ? '错题' : '收藏'}</p>}
    <div className="filter-bar">
      <div className="filter-row"><span className="filter-label">专题：</span>
        <TopicPicker topics={topics.data?.topics ?? []} value={topic} allowAll onChange={(value) => filterBy({ topic: value })} />
        {topics.error && <button type="button" className="btn btn-sm" onClick={topics.retry}>重试专题</button>}
      </div>
      <div className="filter-row" role="group" aria-label="按题型筛选"><span className="filter-label">题型：</span>
        {questionTypes.map((entry) => <button key={entry.label} type="button" className={`filter-chip ${entry.value === type ? 'active' : ''}`}
          aria-pressed={entry.value === type} onClick={() => filterBy({ type: entry.value })}>{entry.label}</button>)}
      </div>
      {list === 'all' && <div className="filter-row" role="group" aria-label="按作答状态筛选"><span className="filter-label">状态：</span>
        {statuses.map((entry) => <button key={entry.label} type="button" className={`filter-chip ${entry.value === status ? 'active' : ''}`}
          aria-pressed={entry.value === status} onClick={() => filterBy({ status: entry.value })}>{entry.label}</button>)}
      </div>}
    </div>
    <QuestionList key={JSON.stringify([topic, type, q, filter])} view={view} q={q} status={filter} list={list}
      onPageChange={(index) => filterBy({ page: index })} onLimitChange={(size) => filterBy({ limit: size })} />
  </>
}

export function Library({ list }: { list: LibraryList }) {
  const { preferences } = useStudySessionContext()
  return preferences.ready ? <LibraryContent list={list} /> : <LoadMessage loading />
}
