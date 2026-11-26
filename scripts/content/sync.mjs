import pg from 'pg'
import { practiceApproved, questionRevision, readCatalog, validateCatalog } from './catalog.mjs'
import { makeRelease, qualityReport } from './release.mjs'

async function updateCatalog(client, catalog) {
  const knownTopics = (await client.query('SELECT id FROM topics')).rows
  const incomingTopics = new Set(catalog.topics.map(topic => topic.id))
  if (knownTopics.some(topic => !incomingTopics.has(topic.id))) throw new Error('停用专题须原地设置 active 为 false。')
  await client.query('UPDATE topics SET sort_order = sort_order + 1000000')
  await client.query(`
    INSERT INTO topics (id, name, scope_note, active, sort_order)
    SELECT row->>'id', row->>'name', row->>'scopeNote', (row->>'active')::boolean, position
    FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS source(row, position)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, scope_note = excluded.scope_note,
      active = excluded.active, sort_order = excluded.sort_order
  `, [JSON.stringify(catalog.topics)])
  await client.query(`
    INSERT INTO sources (id, title, publisher, url, attachment_url, document_date, webpage_date,
      effective_from, effective_to, retrieved_on, media_type, access_status, page_count, sha256, rights_note)
    SELECT row->>'id', row->>'title', row->>'publisher', row->>'url', row->>'attachmentUrl',
      (row->>'documentDate')::date, (row->>'webpageDate')::date, (row->>'effectiveFrom')::date,
      (row->>'effectiveTo')::date, (row->>'retrievedOn')::date, row->>'format', row->>'status',
      (row->>'pages')::int, row->>'sha256', row->>'rightsNote'
    FROM jsonb_array_elements($1::jsonb) AS source(row)
    ON CONFLICT (id) DO UPDATE SET title = excluded.title, publisher = excluded.publisher, url = excluded.url,
      attachment_url = excluded.attachment_url, document_date = excluded.document_date, webpage_date = excluded.webpage_date,
      effective_from = excluded.effective_from, effective_to = excluded.effective_to, retrieved_on = excluded.retrieved_on,
      media_type = excluded.media_type, access_status = excluded.access_status, page_count = excluded.page_count,
      sha256 = excluded.sha256, rights_note = excluded.rights_note
  `, [JSON.stringify(catalog.sources)])
  await client.query(`
    UPDATE sources s SET superseded_by = row->>'supersededBy'
    FROM jsonb_array_elements($1::jsonb) AS source(row) WHERE s.id = row->>'id'
  `, [JSON.stringify(catalog.sources)])
  await client.query(`
    INSERT INTO knowledge_points (id, topic_id, fact_key, fact, importance, source_id, location, scope_note)
    SELECT (row->>'id')::uuid, row->>'topicId', row->>'factKey', row->>'fact', row->>'importance',
      row->>'sourceId', row->>'location', row->>'scopeNote' FROM jsonb_array_elements($1::jsonb) AS source(row)
    ON CONFLICT (id) DO UPDATE SET topic_id = excluded.topic_id, fact_key = excluded.fact_key, fact = excluded.fact,
      importance = excluded.importance, source_id = excluded.source_id, location = excluded.location, scope_note = excluded.scope_note
  `, [JSON.stringify(catalog.points)])
}

async function insertParts(client, items) {
  const data = JSON.stringify(items)
  await client.query(`
    INSERT INTO question_options (question_id, id, position, text, rationale)
    SELECT (item->>'id')::uuid, (option->>'id')::uuid, position, option->>'text', option->>'rationale'
    FROM jsonb_array_elements($1::jsonb) AS record(item)
    CROSS JOIN LATERAL jsonb_array_elements(item->'options') WITH ORDINALITY AS opts(option, position)
  `, [data])
  await client.query(`
    INSERT INTO question_answers (question_id, option_id)
    SELECT (item->>'id')::uuid, option_id::uuid FROM jsonb_array_elements($1::jsonb) AS record(item)
    CROSS JOIN LATERAL jsonb_array_elements_text(item->'answerIds') AS selected(option_id)
  `, [data])
  await client.query(`
    INSERT INTO question_explanations (question_id, explanation, distinction)
    SELECT (item->>'id')::uuid, item->>'explanation', item->>'distinction'
    FROM jsonb_array_elements($1::jsonb) AS record(item)
  `, [data])
  await client.query(`
    INSERT INTO question_knowledge_points (question_id, knowledge_point_id)
    SELECT (item->>'id')::uuid, point::uuid FROM jsonb_array_elements($1::jsonb) AS record(item)
    CROSS JOIN LATERAL jsonb_array_elements_text(item->'relatedKnowledgePointIds') AS points(point)
  `, [data])
  await client.query(`
    INSERT INTO question_evidence (question_id, option_id, source_id, location, claim)
    SELECT (item->>'id')::uuid, (source->>'optionId')::uuid, source->>'sourceId', source->>'location', source->>'claim'
    FROM jsonb_array_elements($1::jsonb) AS record(item)
    CROSS JOIN LATERAL jsonb_array_elements(item->'fullEvidence') AS sources(source)
    ORDER BY item->>'id', source->>'optionId', source->>'sourceId', source->>'location', source->>'claim'
  `, [data])
  await client.query(`
    INSERT INTO question_reviews (question_id, phase, reviewer, outcome, independently_selected,
      emotion_only, notes, content_sha256, reviewed_at)
    SELECT (item->>'id')::uuid, phase, review->>'reviewer', review->>'decision',
      ARRAY(SELECT option::uuid FROM jsonb_array_elements_text(review->'choice') AS chosen(option)),
      (review->>'emotionOnly')::boolean, review->>'notes', question_digest((item->>'id')::uuid),
      (review->>'date')::date::timestamp AT TIME ZONE 'Asia/Singapore'
    FROM jsonb_array_elements($1::jsonb) AS record(item)
    CROSS JOIN LATERAL jsonb_each(COALESCE(item->'reviews', '{}'::jsonb)) AS review_row(phase, review)
  `, [data])
}

async function practiceOrder(client) {
  const { rows } = await client.query('SELECT id, topic_id, bank_position FROM active_bank_questions ORDER BY bank_position NULLS LAST, id')
  const groups = new Map([['sequence', rows], ['random-undone', rows]])
  for (const item of rows) {
    const scope = `topic:${item.topic_id}`
    if (!groups.has(scope)) groups.set(scope, [])
    groups.get(scope).push(item)
  }
  return groups
}

async function restorePracticePositions(client, previous, ranks) {
  const current = await practiceOrder(client)
  const moves = []
  for (const [scope, oldQuestions] of previous) {
    const questions = current.get(scope) ?? []
    const positions = new Map(questions.map(({ id }, index) => [id, index]))
    for (const [index, { id }] of oldQuestions.entries()) {
      let position = positions.get(id)
      if (position === undefined) {
        const next = questions.findIndex(({ bank_position }) => bank_position > ranks.get(id))
        position = next < 0 ? Math.max(0, questions.length - 1) : next
      }
      if (position !== index) moves.push({ name: `practice-position:${scope}`, old_position: index, new_position: position })
    }
  }
  if (moves.length) await client.query(`
    UPDATE study_preferences p SET value = to_jsonb(m.new_position)
    FROM jsonb_to_recordset($1::jsonb) m(name text, old_position int, new_position int)
    WHERE p.name = m.name AND p.value = to_jsonb(m.old_position)
  `, [JSON.stringify(moves)])
}

const personalPracticeMembership = `
  CASE p.name WHEN 'practice-position:favorite' THEN EXISTS (
    SELECT 1 FROM favorites f WHERE f.user_id = p.user_id AND f.question_id = q.id
  ) ELSE EXISTS (
    SELECT 1 FROM question_progress w WHERE w.user_id = p.user_id AND w.question_id = q.id AND w.is_wrong
  ) END
`

async function personalPracticeAnchors(client) {
  const { rows } = await client.query(`
    WITH bookmarks AS MATERIALIZED (
      SELECT user_id, name, value::text::int AS old_position
      FROM study_preferences
      WHERE name IN ('practice-position:favorite', 'practice-position:wrong')
        AND value::text ~ '^[0-9]{1,7}$'
    )
    SELECT p.user_id, p.name, p.old_position, anchor.id
    FROM bookmarks p
    CROSS JOIN LATERAL (
      SELECT q.id FROM active_bank_questions q
      WHERE ${personalPracticeMembership}
      ORDER BY q.bank_position NULLS LAST, q.id OFFSET p.old_position LIMIT 1
    ) anchor
  `)
  return rows
}

async function restorePersonalPracticePositions(client, anchors) {
  if (!anchors.length) return
  await client.query(`
    WITH moves AS (
      SELECT p.user_id, p.name, p.old_position, GREATEST(0, LEAST(
        count(q.id) - 1, count(q.id) FILTER (WHERE q.bank_position < slot.position)
      ))::int AS new_position
      FROM jsonb_to_recordset($1::jsonb) p(user_id text, name text, old_position int, id uuid)
      JOIN question_bank_positions slot ON slot.question_id = p.id
      LEFT JOIN active_bank_questions q ON ${personalPracticeMembership}
      GROUP BY p.user_id, p.name, p.old_position, slot.position
    )
    UPDATE study_preferences p SET value = to_jsonb(m.new_position)
    FROM moves m
    WHERE p.user_id = m.user_id AND p.name = m.name AND p.value = to_jsonb(m.old_position)
      AND m.old_position <> m.new_position
  `, [JSON.stringify(anchors)])
}

export async function syncCatalog(client, catalog, indexes, { dryRun = true } = {}) {
  const released = makeRelease(catalog, indexes).manifest.release
  await client.query('BEGIN')
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eqb/content-publish'))")
    await client.query('SET CONSTRAINTS ALL DEFERRED')
    const existing = (await client.query('SELECT id FROM questions')).rows
    if (existing.some(item => !indexes.questionIndex.has(item.id))) {
      throw new Error('已使用的题目 ID 必须保留。下架题请将 state 设为 withdrawn。')
    }
    const order = (await client.query('SELECT question_id, position FROM question_bank_positions')).rows
    if (order.some(({ question_id, position }) => indexes.orderIndex.get(question_id) !== position)) {
      throw new Error('已登记的题目位置不可调整。新题请追加到 question-order.json 末尾。')
    }
    const previousPositions = await practiceOrder(client)
    const personalAnchors = await personalPracticeAnchors(client)
    await updateCatalog(client, catalog)
    const ids = catalog.questions.map(item => item.id)
    const data = JSON.stringify(catalog.questions.map(item => ({
      ...item,
      revision: questionRevision(item),
      searchText: [item.stem, ...item.options.map(option => option.text)].join('\n').normalize('NFKC').toLowerCase(),
      fullEvidence: item.evidence.concat(item.options.flatMap(option =>
        option.evidence.map(evidence => ({ ...evidence, optionId: option.id })))),
    })))
    await client.query("UPDATE questions SET status = 'draft' WHERE id = ANY($1::uuid[])", [ids])
    for (const table of ['question_reviews', 'question_evidence', 'question_answers', 'question_options',
      'question_explanations', 'question_knowledge_points']) {
      await client.query(`DELETE FROM ${table} WHERE question_id = ANY($1::uuid[])`, [ids])
    }
    await client.query('DELETE FROM duplicate_reviews WHERE first_question_id = ANY($1::uuid[])', [ids])
    await client.query(`
      INSERT INTO questions (id, topic_id, knowledge_point_id, type, stem, search_text, scope_note, difficulty,
        task_type, difficulty_reason, emotion_only, emotion_reason, order_locked, content_revision)
      SELECT (item->>'id')::uuid, item->>'topicId', (item->>'knowledgePointId')::uuid, item->>'type',
        item->>'stem', item->>'searchText', item->>'scopeNote', item->>'difficulty', item->>'taskType',
        item->>'difficultyReason', (item->>'emotionOnly')::boolean, item->>'emotionReason',
        (item->>'orderLocked')::boolean, item->>'revision'
      FROM jsonb_array_elements($1::jsonb) AS record(item)
      ON CONFLICT (id) DO UPDATE SET topic_id = excluded.topic_id, knowledge_point_id = excluded.knowledge_point_id,
        type = excluded.type, stem = excluded.stem, search_text = excluded.search_text, scope_note = excluded.scope_note,
        difficulty = excluded.difficulty, task_type = excluded.task_type, difficulty_reason = excluded.difficulty_reason,
        emotion_only = excluded.emotion_only, emotion_reason = excluded.emotion_reason,
        order_locked = excluded.order_locked, content_revision = excluded.content_revision, updated_at = now()
    `, [data])
    await client.query(`
      INSERT INTO question_bank_positions (question_id, position)
      SELECT id::uuid, position FROM jsonb_array_elements_text($1::jsonb) WITH ORDINALITY AS slots(id, position)
      ON CONFLICT (question_id) DO NOTHING
    `, [JSON.stringify(catalog.questionOrder)])
    await insertParts(client, JSON.parse(data))
    await client.query(`
      INSERT INTO duplicate_reviews (first_question_id, second_question_id, outcome, reviewer, reason)
      SELECT least((item->>'a')::uuid, (item->>'b')::uuid), greatest((item->>'a')::uuid, (item->>'b')::uuid),
        item->>'disposition', item->>'reviewer', item->>'notes'
      FROM jsonb_array_elements($1::jsonb) AS record(item)
    `, [JSON.stringify(catalog.duplicateReviews)])
    const ready = catalog.questions.filter(item => item.state === 'ready')
    const published = ready.filter(item => practiceApproved(item, indexes.practiceIndex)).map(item => item.id)
    const publishedSet = new Set(published)
    const approved = ready.filter(item => !publishedSet.has(item.id)).map(item => item.id)
    const withdrawn = catalog.questions.filter(item => item.state === 'withdrawn').map(item => item.id)
    await client.query("UPDATE questions SET status = 'quarantined' WHERE id = ANY($1::uuid[])", [withdrawn])
    await client.query("UPDATE questions SET status = 'approved' WHERE id = ANY($1::uuid[])", [approved])
    await client.query("UPDATE questions SET status = 'published' WHERE id = ANY($1::uuid[])", [published])
    await restorePracticePositions(client, previousPositions, indexes.orderIndex)
    await restorePersonalPracticePositions(client, personalAnchors)
    await client.query(`
      INSERT INTO content_release (digest) VALUES ($1)
      ON CONFLICT (singleton) DO UPDATE SET digest = excluded.digest, published_at = now()
    `, [released])
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT')
    return { release: released, published: published.length, withdrawn: withdrawn.length, dryRun }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/content/sync.mjs')) {
  const args = process.argv.slice(2)
  if (args.some(arg => !['--apply', '--release', '--preview'].includes(arg)) ||
      (args.includes('--preview') && args.includes('--release'))) {
    throw new Error('Use --apply with either --preview or --release.')
  }
  const connectionString = process.env.CONTENT_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Set CONTENT_DATABASE_URL in the authorized operator environment.')
  const dryRun = !args.includes('--apply')
  const production = args.includes('--release')
  if (!dryRun && !production && !args.includes('--preview') &&
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname)) {
    throw new Error('Use --preview for an isolated preview database or --release for production.')
  }
  const catalog = await readCatalog()
  const indexes = validateCatalog(catalog)
  const report = qualityReport(catalog, indexes)
  if (production && report.problems.length) throw new Error(report.problems.join('\n'))
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    console.log(JSON.stringify(await syncCatalog(client, catalog, indexes, { dryRun })))
  } finally {
    await client.end()
  }
}
