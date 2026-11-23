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
