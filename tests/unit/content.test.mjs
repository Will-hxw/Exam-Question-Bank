import assert from 'node:assert/strict'
import { test } from 'node:test'
import { practiceApproved, questionRevision, readCatalog, sha256, validateCatalog } from '../../scripts/content/catalog.mjs'
import { makeRelease, qualityReport } from '../../scripts/content/release.mjs'

test('the public manifest contains only fact and style approved content in hashed 15-question pages', async () => {
  const catalog = await readCatalog()
  const indexes = validateCatalog(catalog)
  const { manifest, files } = makeRelease(catalog, indexes)
  const approved = new Map(catalog.questions.filter(item => practiceApproved(item, indexes.practiceIndex)).map(item => [item.id, item]))
  const all = manifest.groups._all
  assert.equal(all.total, approved.size)
  const found = new Set()
  for (const path of all.pages) {
    const name = path.split('/').at(-1)
    const body = files.get(name)
    assert.equal(name, sha256(body) + '.json')
    const { questions } = JSON.parse(body)
    assert.ok(questions.length > 0 && questions.length <= 15)
    for (const item of questions) {
      assert.equal(item.contentRevision, questionRevision(approved.get(item.id)))
      assert.ok(!found.has(item.id))
      found.add(item.id)
    }
  }
  assert.equal(found.size, approved.size)
})

test('a style review applies only to the precise revision that was reviewed', async () => {
  const catalog = await readCatalog()
  const indexes = validateCatalog(catalog)
  const actual = qualityReport(catalog, indexes)
  const one = catalog.practiceReviews.find(review => review.decision === 'keep'
    && indexes.questionIndex.get(review.questionId).state === 'ready'
    && questionRevision(indexes.questionIndex.get(review.questionId)) === review.digest)
  assert.ok(one)
  const fakeIndexes = { ...indexes, practiceIndex: new Map(indexes.practiceIndex) }
  fakeIndexes.practiceIndex.set(one.questionId, { ...one, digest: '0'.repeat(64) })
  assert.equal(qualityReport(catalog, fakeIndexes).review.practiceReady, actual.review.practiceReady - 1)
})

test('single-answer position limits apply to reorderable choices while reporting locked choices', () => {
  const questions = Array.from({ length: 12 }, (_, index) => {
    const options = ['1', '2', '3', '4'].map(text => ({ id: `${index}-${text}`, text }))
    const orderLocked = index < 8
    return {
      id: String(index),
      state: 'ready',
      topicId: 'topic',
      type: 'single',
      stem: String(index),
      knowledgePointId: String(index),
      relatedKnowledgePointIds: [],
      emotionOnly: false,
      orderLocked,
      options,
      answerIds: [options[orderLocked ? 0 : index - 8].id],
    }
  })
  const catalog = { questions, topics: [{ id: 'topic', active: true }], points: [] }
  const indexes = { practiceIndex: new Map(), duplicateIndex: new Map() }
  const report = qualityReport(catalog, indexes)
  const stats = report.stats._all.byTypeAndOptions['single/4']
  assert.deepEqual(stats.positions, [9, 1, 1, 1])
  assert.deepEqual(stats.unlockedPositions, [1, 1, 1, 1])
  assert.ok(report.problems.every(problem => !problem.includes('四选单选答案位置')))

  const unbalanced = questions.map(question => question.orderLocked ? question : {
    ...question, answerIds: [question.options[0].id],
  })
  const actual = qualityReport({ ...catalog, questions: unbalanced }, indexes)
  assert.equal(actual.problems.filter(problem => problem.includes('四选单选答案位置')).length, 2)
})
