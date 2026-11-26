import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'

export const CONTENT_DIRECTORY = new URL('../../content/', import.meta.url)
const text = z.string().trim().min(1)
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const uuid = z.uuid().transform(value => value.toLowerCase())
const date = z.iso.date().optional()
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const url = z.url().refine(value => new URL(value).protocol === 'https:')
const evidence = z.strictObject({ sourceId: text, location: text, claim: text })
const review = z.strictObject({
  reviewer: text, date: z.iso.date(), choice: z.array(uuid).min(1).max(6),
  decision: z.enum(['approved', 'changes', 'rejected']), emotionOnly: z.boolean(),
  notes: text, digest: hash,
})
const topics = z.array(z.strictObject({ id: slug, name: text, scopeNote: text, active: z.boolean() }))
const sources = z.array(z.strictObject({
  id: text, title: text, publisher: text, url, attachmentUrl: url.optional(),
  documentDate: date, webpageDate: date, effectiveFrom: date, effectiveTo: date, retrievedOn: date,
  format: text, status: z.enum(['full', 'partial', 'index', 'restricted', 'unavailable', 'pending']),
  pages: z.number().int().positive().optional(), sha256: hash.optional(), rightsNote: text,
  supersededBy: text.optional(),
}))
const points = z.array(z.strictObject({
  id: uuid, topicId: slug, factKey: slug, fact: text, importance: z.enum(['core', 'general']),
  sourceId: text, location: text, scopeNote: text,
}))
export const questionSchema = z.strictObject({
  id: uuid, state: z.enum(['draft', 'ready', 'withdrawn']),
  topicId: slug, knowledgePointId: uuid, relatedKnowledgePointIds: z.array(uuid),
  type: z.enum(['single', 'multiple']), stem: text, scopeNote: text,
  difficulty: z.enum(['basic', 'intermediate', 'advanced']),
  taskType: z.enum(['recall', 'distinction', 'application']), difficultyReason: text,
  emotionOnly: z.boolean(), emotionReason: text, orderLocked: z.boolean(),
  options: z.array(z.strictObject({ id: uuid, text, rationale: text, evidence: z.array(evidence).min(1) })).min(2).max(6),
  answerIds: z.array(uuid).min(1).max(6),
  explanation: text, distinction: text, evidence: z.array(evidence).min(1),
  reviews: z.strictObject({ initial: review.optional(), independent: review.optional() }).optional(),
})
const duplicateSchema = z.array(z.strictObject({
  a: uuid, b: uuid, disposition: z.enum(['distinct', 'duplicate', 'pending']),
  reviewer: text, notes: text,
}))
const practiceReviewSchema = z.array(z.strictObject({
  questionId: uuid, digest: hash, reviewer: text,
  decision: z.enum(['keep', 'shorten', 'rewrite']), reason: text,
  proposal: z.string(),
}))

async function read(directory, filename, schema) {
  const raw = await readFile(new URL(filename, directory), 'utf8')
  return schema.parse(JSON.parse(raw))
}

export async function readCatalog(directory = CONTENT_DIRECTORY) {
  const [topicRows, sourceRows, pointRows, questionRows, duplicateReviews, practiceReviews, questionOrder] = await Promise.all([
    read(directory, 'topics.json', topics),
    read(directory, 'sources.json', sources),
    read(directory, 'knowledge-points.json', points),
    read(directory, 'questions.json', z.array(questionSchema)),
    read(directory, 'duplicate-reviews.json', duplicateSchema),
    read(directory, 'practice-reviews.json', practiceReviewSchema),
    read(directory, 'question-order.json', z.array(uuid)),
  ])
  return { topics: topicRows, sources: sourceRows, points: pointRows, questions: questionRows, duplicateReviews, practiceReviews, questionOrder }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function normalize(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')
}

export function questionRevision(question) {
  const body = { ...question }
  delete body.state
  delete body.reviews
  return sha256(JSON.stringify(stable(body)))
}

export function practiceApproved(question, practiceIndex) {
  const review = practiceIndex.get(question.id)
  return question.state === 'ready' && review?.decision === 'keep' && review.digest === questionRevision(question)
}

export function mapRows(rows, key, label) {
  const index = new Map()
  for (const row of rows) {
    if (index.has(row[key])) throw new Error(`${label} 重复：${row[key]}`)
    index.set(row[key], row)
  }
  return index
}

const setKey = values => [...new Set(values)].sort().join(',')
const pairKey = (first, second) => [first, second].sort().join('/')

export function validateCatalog(catalog) {
  const topicIndex = mapRows(catalog.topics, 'id', '专题 ID')
  const sourceIndex = mapRows(catalog.sources, 'id', '来源 ID')
  const pointIndex = mapRows(catalog.points, 'id', '知识点 ID')
  const questionIndex = mapRows(catalog.questions, 'id', '题目 ID')
  mapRows(catalog.points, 'factKey', '事实键')
  for (const point of catalog.points) {
    if (!topicIndex.has(point.topicId) || !sourceIndex.has(point.sourceId)) throw new Error(`知识点关联缺失：${point.id}`)
  }
  for (const source of catalog.sources) {
    if (source.supersededBy && (source.supersededBy === source.id || !sourceIndex.has(source.supersededBy))) {
      throw new Error(`来源替代链缺失：${source.id}`)
    }
  }
  const allOptions = new Set()
  for (const item of catalog.questions) {
    const point = pointIndex.get(item.knowledgePointId)
    const optionIndex = mapRows(item.options, 'id', '选项 ID')
    const normalizedOptions = new Set(item.options.map(option => normalize(option.text)))
    const usedEvidence = [...item.evidence, ...item.options.flatMap(option => option.evidence)]
    const expected = item.type === 'single' ? 1 : 2
    if (!point || point.topicId !== item.topicId
      || item.relatedKnowledgePointIds.some(id => id === point.id || !pointIndex.has(id))
      || new Set(item.relatedKnowledgePointIds).size !== item.relatedKnowledgePointIds.length
      || normalizedOptions.has('') || normalizedOptions.size !== item.options.length
      || new Set(item.answerIds).size !== item.answerIds.length
      || item.answerIds.some(id => !optionIndex.has(id))
      || item.answerIds.length < expected || (item.type === 'single' && item.answerIds.length !== 1)
      || usedEvidence.some(entry => !sourceIndex.has(entry.sourceId))) {
      throw new Error(`题目结构或证据关联无效：${item.id}`)
    }
    for (const id of optionIndex.keys()) {
      if (allOptions.has(id)) throw new Error(`选项 ID 跨题重复：${id}`)
      allOptions.add(id)
    }
    if (item.state !== 'ready') continue
    if (!topicIndex.get(item.topicId)?.active || sourceIndex.get(point.sourceId)?.status !== 'full'
      || usedEvidence.some(entry => sourceIndex.get(entry.sourceId)?.status !== 'full')) {
      throw new Error(`待发布题需启用专题与完整原文证据：${item.id}`)
    }
    const { initial, independent } = item.reviews ?? {}
    const digest = questionRevision(item)
    if (!initial || !independent || initial.reviewer.trim().toLowerCase() === independent.reviewer.trim().toLowerCase()
      || initial.date > independent.date || [initial, independent].some(result =>
        result.decision !== 'approved' || result.digest !== digest || result.emotionOnly !== item.emotionOnly
        || result.choice.length !== item.answerIds.length || setKey(result.choice) !== setKey(item.answerIds))) {
      throw new Error(`待发布题缺少同一内容的独立复审：${item.id}`)
    }
  }

  const duplicateIndex = new Map()
  for (const resolution of catalog.duplicateReviews) {
    const key = pairKey(resolution.a, resolution.b)
    if (resolution.a === resolution.b || !questionIndex.has(resolution.a) || !questionIndex.has(resolution.b) || duplicateIndex.has(key)) {
      throw new Error(`重复核查记录无效：${key}`)
    }
    duplicateIndex.set(key, resolution)
  }
  const practiceIndex = mapRows(catalog.practiceReviews, 'questionId', '考法复核题目 ID')
  for (const review of practiceIndex.values()) {
    if (!questionIndex.has(review.questionId)) throw new Error("考法复核对应的题目不存在：" + review.questionId)
  }
  const orderIndex = new Map(catalog.questionOrder.map((id, index) => [id, index + 1]))
  if (orderIndex.size !== catalog.questionOrder.length || catalog.questionOrder.some((id) => !questionIndex.has(id))) {
    throw new Error('题库顺序存在重复或未知题目 ID。')
  }
  for (const item of catalog.questions) {
    if ((practiceApproved(item, practiceIndex) || item.state === 'withdrawn') && !orderIndex.has(item.id)) {
      throw new Error(`待发布或下架的题缺少顺序记录：${item.id}。先运行 node scripts/content/release.mjs order。`)
    }
  }
  return { topicIndex, sourceIndex, pointIndex, questionIndex, duplicateIndex, practiceIndex, orderIndex }
}

export function duplicateCandidates(questions) {
  const results = []
  const indexed = questions.map(item => {
    const stem = normalize(item.stem)
    const triples = new Set(Array.from({ length: Math.max(0, stem.length - 2) }, (_, index) => stem.slice(index, index + 3)))
    const options = item.options.map(option => normalize(option.text)).sort().join('|')
    return { item, stem, triples, options }
  })
  for (const [index, left] of indexed.entries()) {
    for (let offset = index + 1; offset < indexed.length; offset++) {
      const right = indexed[offset]
      const equalStem = left.stem === right.stem
      const smaller = left.triples.size < right.triples.size ? left.triples : right.triples
      const larger = smaller === left.triples ? right.triples : left.triples
      if (!equalStem && smaller.size < larger.size * .7) continue
      let common = 0
      for (const trigram of smaller) if (larger.has(trigram)) common++
      const ratio = common / (smaller.size + larger.size - common)
      if (equalStem || ratio >= .7) {
        results.push({ pair: pairKey(left.item.id, right.item.id), exact: equalStem && left.options === right.options, ratio: equalStem ? 1 : ratio })
      }
    }
  }
  return results
}
