import { randomUUID } from 'node:crypto'

export async function seedQuestions(client, amount = 52, multipleIndex = -1) {
  await client.query(`
    INSERT INTO sources(id, title, publisher, url, access_status, rights_note)
    VALUES ('test-only', '测试资料', '测试环境', 'https://example.invalid/test', 'full', '合成测试数据')
  `)
  const questions = []
  for (let index = 0; index < amount; index++) {
    const topic = index % 2 ? 't01' : 't14'
    const id = randomUUID()
    const options = Array.from({ length: 4 }, () => randomUUID())
    const type = index === multipleIndex ? 'multiple' : 'single'
    const { rows: [{ fact }] } = await client.query(`
      INSERT INTO knowledge_points (topic_id, fact_key, fact, importance, source_id, location, scope_note)
      VALUES ($1, $2, $2, 'core', 'test-only', '原文测试段落', '独立测试数据库')
      RETURNING id AS fact
    `, [topic, `synthetic-fact-${index}`])
    await client.query(`
      INSERT INTO questions (id, topic_id, knowledge_point_id, type, stem, search_text, scope_note, difficulty, task_type,
                             difficulty_reason, emotion_only, emotion_reason)
      VALUES ($1, $2, $3, $5, $4, $4, '独立测试数据库', 'basic', 'recall', '测试理由', false, '测试理由')
    `, [id, topic, fact, `分层练习样例 ${index}`, type])
    for (const [position, option] of options.entries()) {
      await client.query(`
        INSERT INTO question_options (question_id, id, position, text, rationale)
        VALUES ($1, $2, $3, $4, '选项理由用于测试返回与答案保密')
      `, [id, option, position + 1, `选项文本 ${position + 1}`])
      await client.query(`
        INSERT INTO question_evidence (question_id, option_id, source_id, location, claim)
        VALUES ($1, $2, 'test-only', '测试第2段', '选项证据测试')
      `, [id, option])
    }
    const correct = options[index % 4]
    const answerIds = (type === 'multiple' ? [correct, options[(index + 2) % 4]] : [correct]).sort()
    await client.query('INSERT INTO question_answers SELECT $1, unnest($2::uuid[])', [id, answerIds])
    await client.query("INSERT INTO question_explanations VALUES ($1, '总解析测试', '混淆点测试')", [id])
    await client.query(`
      INSERT INTO question_evidence (question_id, source_id, location, claim)
      VALUES ($1, 'test-only', '测试第1段', '结构化测试引用')
    `, [id])
    questions.push({ id, fact, correct, answerIds, type, wrong: options[(index + 1) % 4] })
  }
  return questions
}

export async function reviewFixture(client, { id, answerIds }) {
  await client.query(`
    INSERT INTO question_reviews
      (question_id, phase, reviewer, outcome, independently_selected, emotion_only, notes, content_sha256)
    VALUES ($1, 'initial', 'test-initial', 'approved', $2::uuid[], false, '合成用例', question_digest($1)),
           ($1, 'independent', 'test-independent', 'approved', $2::uuid[], false, '合成用例', question_digest($1))
  `, [id, answerIds])
}
