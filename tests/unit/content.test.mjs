import assert from 'node:assert/strict'
import { test } from 'node:test'
import { practiceApproved, questionRevision, readCatalog, sha256, validateCatalog } from '../../scripts/content/catalog.mjs'
import { makeRelease, qualityReport } from '../../scripts/content/release.mjs'
import { syncCatalog } from '../../scripts/content/sync.mjs'

test('withdrawal leaves surviving UUIDs in order and a new low UUID appends', async () => {
  const catalog = await readCatalog()
  const indexes = validateCatalog(catalog)
  const idsFor = ({ manifest, files }) => manifest.groups._all.pages.flatMap((path) =>
    JSON.parse(files.get(path.split('/').at(-1))).questions.map(({ id }) => id))
  const before = idsFor(makeRelease(catalog, indexes))
  const withdrawnId = before[2]
  const withdrawn = indexes.questionIndex.get(withdrawnId)
  withdrawn.state = 'withdrawn'
  const added = { ...withdrawn, id: '00000000-0000-4000-8000-000000000001', state: 'ready' }
  catalog.questions.unshift(added)
  indexes.practiceIndex.set(added.id, { decision: 'keep', digest: questionRevision(added) })
  indexes.orderIndex.set(added.id, catalog.questionOrder.length + 1)
  assert.deepEqual(idsFor(makeRelease(catalog, indexes)), [...before.filter((id) => id !== withdrawnId), added.id])
})

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

test('content sync rejects changing an existing revision or bypassing retirement', async () => {
  const catalog = await readCatalog()
  const indexes = validateCatalog(catalog)
  const item = catalog.questions.find(question => question.state === 'ready')
  const revision = questionRevision(item)
  const statements = []
  let status = 'published'
  const client = {
    async query(sql) {
      statements.push(sql)
      if (sql === 'SELECT id, status, content_revision FROM questions') {
        return { rows: [{ id: item.id, status, content_revision: revision }] }
      }
      assert.match(sql, /^(BEGIN|SELECT pg_advisory_xact_lock|SET CONSTRAINTS|ROLLBACK)/)
      return { rows: [] }
    },
  }

  const original = item.explanation
  item.explanation += ' 修订解析。'
  await assert.rejects(syncCatalog(client, catalog, indexes), /内容已变更/)
  assert.equal(statements.at(-1), 'ROLLBACK')

  item.explanation = original
  status = 'quarantined'
  await assert.rejects(syncCatalog(client, catalog, indexes), /已下架/)
  assert.equal(statements.at(-1), 'ROLLBACK')

  status = 'published'
  item.state = 'draft'
  await assert.rejects(syncCatalog(client, catalog, indexes), /停止展示时/)
  assert.equal(statements.at(-1), 'ROLLBACK')
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
