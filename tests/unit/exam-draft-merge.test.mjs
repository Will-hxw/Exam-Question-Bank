import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeExamDraft, mergeExamDraft, unsubmittedAnswerIds } from '../../src/features/study/exam-draft-merge.ts'

const draft = (answers, marked = [], position = 0, revision = 2) => ({ answers, marked, position, revision })

test('merges disjoint answers, explicit clear, marks, and navigation against the saved base', () => {
  const base = draft({ clear: ['A'], remote: ['D'] }, ['removed'], 1)
  const local = draft({ clear: [], remote: ['D'], first: ['B'] }, ['local-mark'], 1)
  const cloud = draft({ clear: ['A'], remote: ['C'], second: ['A'] }, ['removed', 'cloud-mark'], 3, 5)
  const merged = mergeExamDraft(local, cloud, base)
  assert.deepEqual(merged, {
    draft: draft({ clear: [], remote: ['C'], first: ['B'], second: ['A'] }, ['local-mark', 'cloud-mark'], 3, 5),
    conflicts: [],
  })
})

test('requests an explicit choice for competing edits and treats reordered selections as equal', () => {
  const base = draft({ competing: ['A'], same: ['B'] })
  const local = draft({ competing: [], same: ['C', 'A'] }, [], 1)
  const cloud = draft({ competing: ['C'], same: ['A', 'C'] }, [], 3, 4)
  const merged = mergeExamDraft(local, cloud, base)
  assert.deepEqual(merged.conflicts, [{ id: 'competing', local: [], cloud: ['C'] }])
  assert.deepEqual(merged.draft, draft({ competing: [], same: ['C', 'A'] }, [], 1, 4))
})

test('recovers legacy drafts without silently replacing an answer found in both copies', () => {
  const local = draft({ first: ['A'], conflict: ['B'] }, ['local-mark'])
  const cloud = draft({ last: ['C'], conflict: [] }, ['cloud-mark'], 3, 5)
  const stored = decodeExamDraft(local)
  assert.deepEqual(stored, { draft: local, base: null })
  assert.deepEqual(mergeExamDraft(stored.draft, cloud, stored.base), {
    draft: draft({ first: ['A'], conflict: ['B'], last: ['C'] }, ['local-mark', 'cloud-mark'], 0, 5),
    conflicts: [{ id: 'conflict', local: ['B'], cloud: [] }],
  })
  assert.deepEqual(decodeExamDraft({ draft: local, base: cloud }), stored)
  assert.equal(decodeExamDraft({ draft: { ...local, marked: 'invalid' } }), null)
})

test('an already submitted result distinguishes unapplied local answers from earlier cloud answers', () => {
  const base = draft({ previouslySaved: ['A'], clear: ['B'] })
  const local = draft({ previouslySaved: ['A'], clear: [], savedByOtherDevice: ['B'], unsent: ['D'] })
  const result = draft({ previouslySaved: ['B'], clear: ['B'], savedByOtherDevice: ['B'] }, [], 5, 6)
  assert.deepEqual(unsubmittedAnswerIds({ draft: local, base }, result), ['clear', 'unsent'])
})
