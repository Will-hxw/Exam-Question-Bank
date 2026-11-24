'use client'

import { useEffect, useState } from 'react'
import { answerLetters, type Explanation, letter, type Question, type QuestionPage, type QuestionState, type QuestionType, type Status } from './api'
import { ExplanationPanel, LoadMessage, TopicPicker } from './controls'
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
function QuestionRow({ question, state, list }: { question: Question; state?: Partial<QuestionState>; list: 'all' | 'wrong' | 'favorite' }) {
  const { removeWrong } = useStudySessionContext()
  const favoriteControl = useQuestionFavorite(question.id, state?.isFavorite ?? question.isFavorite)
  const [showAnswer, setShowAnswer] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const explanation = useStudyData<Explanation>(showAnswer ? `/api/public/questions/${question.id}/explanation` : null)

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
      {(state?.attempted || question.attempted) && <span className="done-badge">✓ 已答</span>}
    </div>
    <p className="q-text">{question.stem}</p>
    <div className="list-options">
      {question.options.map((option, index) => <span key={option.id}
        className={`opt-line${explanation.data?.answerIds.includes(option.id) ? ' answer-highlight' : ''}`}>{letter(index)}. {option.text}</span>)}
    </div>
    <div className="list-actions">
      <button type="button" aria-expanded={showAnswer} onClick={() => { setShowAnswer(!showAnswer); setExpanded(false) }}>
        {showAnswer ? '隐藏答案' : '显示答案'}
      </button>
      <button type="button" aria-pressed={favoriteControl.favorite} aria-busy={favoriteControl.pending || undefined} onClick={favoriteControl.toggle}>
        {favoriteControl.favorite ? '取消收藏' : '收藏'}
      </button>
      {list === 'wrong' && <button type="button" disabled={saving} onClick={() => void clearWrong()}>移出错题集</button>}
      {explanation.data && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起解析' : '展开解析'}</button>}
    </div>
    {favoriteControl.error && <p className="study-message error" role="alert">{favoriteControl.error}</p>}
    {error && <p className="study-message error" role="alert">{error}</p>}
    {explanation.loading && <p className="study-message" role="status">加载答案中…</p>}
    {explanation.error && <div className="study-message error" role="alert">{explanation.error} <button className="btn btn-sm" type="button" onClick={explanation.retry}>重试</button></div>}
    {explanation.data && <p className="answer-reveal">答案：<span>{answerLetters(explanation.data.options, explanation.data.answerIds)}</span></p>}
    {expanded && explanation.data && <ExplanationPanel content={explanation.data} />}
  </article>
}

function QuestionList({ view, q, status, list, onPageChange, onLimitChange }: {
  view: LibraryView; q: string; status: Status | ''; list: LibraryList
  onPageChange: (index: number) => void; onLimitChange: (limit: number) => void
}) {
  const [loaded, setLoaded] = useState<{ index: number; data: QuestionPage }>()
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

  function move(index: number) {
    if (page.loading) return
    if (index === pageIndex) page.retry()
    else onPageChange(index)
  }

  return <>
    {loaded && <p className="stats-bar">{loaded.data.total} 道符合条件的题目</p>}
    {questions.length === 0 ? <LoadMessage loading={page.loading} error={page.error} retry={page.retry} /> : (
      <div aria-busy={page.loading}>{questions.map((question) => <QuestionRow key={question.id} question={question}
        state={states.data?.states[question.id]} list={list} />)}</div>
    )}
    {questions.length > 0 && page.error && <p className="study-message error" role="alert">
      {page.error} <button type="button" className="btn btn-sm" onClick={page.retry}>重试</button>
    </p>}
    {states.error && <p className="study-message error" role="alert">个人状态加载失败。 <button type="button" className="btn btn-sm" onClick={states.retry}>重试</button></p>}
    {loaded && total > 0 && <nav className="study-pagination" aria-label="题库分页">
      <button type="button" className="btn btn-sm nav-step" disabled={currentIndex === 0} onClick={() => move(currentIndex - 1)}>上一页</button>
      <output className="pagination-position" aria-label="当前页 / 总页数">{currentIndex + 1}/{pageCount}</output>
      <button type="button" className="btn btn-sm nav-step" disabled={currentIndex + 1 >= pageCount} onClick={() => move(currentIndex + 1)}>下一页</button>
      {list === 'all' && <label className="pagination-size">每页题量
        <select className="pagination-select" value={limit} onChange={(event) => onLimitChange(Number(event.target.value))}>
          {libraryPageSizes.map((size) => <option key={size} value={size}>{size} 题</option>)}
        </select>
      </label>}
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
  const { search, type, topic, status, limit } = view
  const q = useDebouncedSearch(search)
  const filter = list === 'all' ? status : list
  const filterBy = (change: Partial<LibraryView>) => preferences.save({ [key]: { ...view, page: 0, ...change } })

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
    <QuestionList key={JSON.stringify([topic, type, q, filter, limit])} view={view} q={q} status={filter} list={list}
      onPageChange={(index) => filterBy({ page: index })} onLimitChange={(size) => filterBy({ limit: size })} />
  </>
}

export function Library({ list }: { list: LibraryList }) {
  const { preferences } = useStudySessionContext()
  return preferences.ready ? <LibraryContent list={list} /> : <LoadMessage loading />
}
