'use client'

import { useState } from 'react'
import { answerLetters, type Explanation, letter, libraryPageSize, type Question, type QuestionPage, type QuestionState, type QuestionType, questionUrl, type Status } from './api'
import { ExplanationPanel, LoadMessage, TopicPicker } from './controls'
import { useQuestionStates, useStudySessionContext } from './study-shell'
import { useDebouncedSearch, useStudyData } from './use-study-data'

const questionTypes: { value: QuestionType | ''; label: string }[] = [
  { value: '', label: '全部' }, { value: 'single', label: '单选' }, { value: 'multiple', label: '多选' },
]
const statuses: { value: Status | ''; label: string }[] = [
  { value: '', label: '全部' }, { value: 'undone', label: '未做' }, { value: 'done', label: '已做' },
  { value: 'wrong', label: '错题' }, { value: 'favorite', label: '收藏' },
]
const pageSizes = [10, libraryPageSize, 30, 50]

function QuestionRow({ question, state, list }: { question: Question; state?: Partial<QuestionState>; list: 'all' | 'wrong' | 'favorite' }) {
  const { setFavorite, removeWrong } = useStudySessionContext()
  const [showAnswer, setShowAnswer] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [favoriteOverride, setFavoriteOverride] = useState<boolean>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const explanation = useStudyData<Explanation>(showAnswer ? `/api/public/questions/${question.id}/explanation` : null)
  const favorite = favoriteOverride ?? state?.isFavorite ?? question.isFavorite

  async function toggleFavorite() {
    if (favorite === undefined || saving) return
    setSaving(true)
    setFavoriteOverride(!favorite)
    setError('')
    try {
      await setFavorite(question.id, !favorite)
    } catch (cause) {
      setFavoriteOverride(favorite)
      setError(cause instanceof Error ? cause.message : '无法保存收藏，请重试。')
    } finally {
      setSaving(false)
    }
  }

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
      <button type="button" aria-pressed={Boolean(favorite)} disabled={favorite === undefined || saving} onClick={() => void toggleFavorite()}>
        {favorite ? '取消收藏' : '收藏'}
      </button>
      {list === 'wrong' && <button type="button" disabled={saving} onClick={() => void clearWrong()}>移出错题集</button>}
      {explanation.data && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起解析' : '展开解析'}</button>}
    </div>
    {error && <p className="study-message error" role="alert">{error}</p>}
    {explanation.loading && <p className="study-message" role="status">加载答案中…</p>}
    {explanation.error && <div className="study-message error" role="alert">{explanation.error} <button className="btn btn-sm" type="button" onClick={explanation.retry}>重试</button></div>}
    {explanation.data && <p className="answer-reveal">答案：<span>{answerLetters(explanation.data.options, explanation.data.answerIds)}</span></p>}
    {expanded && explanation.data && <ExplanationPanel content={explanation.data} />}
  </article>
}

function QuestionList({ topic, type, q, status, list, limit, onLimitChange }: {
  topic: string; type: QuestionType | ''; q: string; status: Status | ''; list: 'all' | 'wrong' | 'favorite'
  limit: number; onLimitChange: (limit: number) => void
}) {
  const [pageIndex, setPageIndex] = useState(0)
  const [loaded, setLoaded] = useState<{ index: number; data: QuestionPage }>()
  const { revision } = useStudySessionContext()
  const page = useStudyData<QuestionPage>(
    questionUrl({ topic, type, q, status, offset: pageIndex ? pageIndex * limit : undefined, limit }),
    status ? revision : 0,
  )
  const total = page.data?.total ?? loaded?.data.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / limit))
  if (page.data && pageIndex >= pageCount) {
    setPageIndex(pageCount - 1)
  } else if (page.data && loaded?.data !== page.data) {
    setLoaded({ index: pageIndex, data: page.data })
  }
  const currentIndex = Math.min(loaded?.index ?? 0, pageCount - 1)
  const questions = loaded?.data.questions ?? []
  const states = useQuestionStates(status ? [] : questions.map((question) => question.id))

  function move(index: number) {
    if (page.loading) return
    if (index === pageIndex) page.retry()
    else setPageIndex(index)
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
      <button type="button" className="btn btn-sm" disabled={currentIndex === 0} onClick={() => move(currentIndex - 1)}>上一页</button>
      <output className="pagination-position" aria-label="当前页 / 总页数">{currentIndex + 1}/{pageCount}</output>
      <button type="button" className="btn btn-sm" disabled={currentIndex + 1 >= pageCount} onClick={() => move(currentIndex + 1)}>下一页</button>
      {list === 'all' && <label className="pagination-size">每页题量
        <select className="pagination-select" value={limit} onChange={(event) => onLimitChange(Number(event.target.value))}>
          {pageSizes.map((size) => <option key={size} value={size}>{size} 题</option>)}
        </select>
      </label>}
      <p className="pagination-loading" role="status">
        {page.loading && currentIndex !== pageIndex ? `正在加载第 ${pageIndex + 1} 页…` : ''}
      </p>
    </nav>}
  </>
}

export function Library({ list }: { list: 'all' | 'wrong' | 'favorite' }) {
  const { topics, stats } = useStudySessionContext()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<QuestionType | ''>('')
  const [topic, setTopic] = useState('')
  const [status, setStatus] = useState<Status | ''>('')
  const [limit, setLimit] = useState(libraryPageSize)
  const q = useDebouncedSearch(search)
  const filter = list === 'all' ? status : list

  return <>
    {list === 'all' && <input className="search-box" type="search" placeholder="搜索题目…" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} aria-label="搜索题目" />}
    {list !== 'all' && stats.data && <p className="stats-bar">共 {list === 'wrong' ? stats.data.wrong : stats.data.favorites} 道{list === 'wrong' ? '错题' : '收藏'}</p>}
    <div className="filter-bar">
      <div className="filter-row"><span className="filter-label">专题：</span>
        <TopicPicker topics={topics.data?.topics ?? []} value={topic} allowAll onChange={setTopic} />
        {topics.error && <button type="button" className="btn btn-sm" onClick={topics.retry}>重试专题</button>}
      </div>
      <div className="filter-row" role="group" aria-label="按题型筛选"><span className="filter-label">题型：</span>
        {questionTypes.map((entry) => <button key={entry.label} type="button" className={`filter-chip ${entry.value === type ? 'active' : ''}`}
          aria-pressed={entry.value === type} onClick={() => setType(entry.value)}>{entry.label}</button>)}
      </div>
      {list === 'all' && <div className="filter-row" role="group" aria-label="按作答状态筛选"><span className="filter-label">状态：</span>
        {statuses.map((entry) => <button key={entry.label} type="button" className={`filter-chip ${entry.value === status ? 'active' : ''}`}
          aria-pressed={entry.value === status} onClick={() => setStatus(entry.value)}>{entry.label}</button>)}
      </div>}
    </div>
    <QuestionList key={JSON.stringify([topic, type, q, filter, limit])} topic={topic} type={type} q={q}
      status={filter} list={list} limit={limit} onLimitChange={setLimit} />
  </>
}
