import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { duplicateCandidates, questionRevision, readCatalog, sha256, validateCatalog } from './catalog.mjs'

export const PAGE_SIZE = 15

function distribution(items) {
  const byTypeAndOptions = {}
  for (const item of items) {
    const size = item.options.length
    const key = `${item.type}/${size}`
    const stats = byTypeAndOptions[key] ??= {
      count: 0, allSelected: 0, positions: Array(size).fill(0), unlockedPositions: Array(size).fill(0),
      answerSizes: {}, combinations: {},
    }
    stats.count++
    const positions = item.options.flatMap((option, index) => item.answerIds.includes(option.id) ? [index] : [])
    for (const index of positions) {
      stats.positions[index]++
      if (!item.orderLocked) stats.unlockedPositions[index]++
    }
    stats.allSelected += Number(size === positions.length)
    stats.answerSizes[positions.length] = (stats.answerSizes[positions.length] || 0) + 1
    const combination = positions.map(index => String.fromCharCode(65 + index)).join('')
    stats.combinations[combination] = (stats.combinations[combination] || 0) + 1
  }
  return {
    total: items.length,
    emotionOnly: items.filter(item => item.emotionOnly).length,
    multiple: items.filter(item => item.type === 'multiple').length,
    allSelected: items.filter(item => item.type === 'multiple' && item.answerIds.length === item.options.length).length,
    byTypeAndOptions,
  }
}

export function qualityReport(catalog, indexes) {
  const ready = catalog.questions.filter(item => item.state === 'ready')
  const byTopic = Object.fromEntries(catalog.topics.map(topic => [topic.id, ready.filter(item => item.topicId === topic.id)]))
  const stats = Object.fromEntries([['_all', ready], ...Object.entries(byTopic)].map(([key, data]) => [key, distribution(data)]))
  const covered = new Set(ready.flatMap(item => [item.knowledgePointId, ...item.relatedKnowledgePointIds]))
  const missingCore = catalog.points.filter(point => point.importance === 'core' && !covered.has(point.id))
  const missingGeneral = catalog.points.filter(point => point.importance === 'general' && !covered.has(point.id))
  const problems = []

  if (ready.length < 50) problems.push('组卷至少需要 50 道有独立知识点的合格题。')
  for (const topic of catalog.topics) {
    if (topic.active && !catalog.points.some(point => point.topicId === topic.id && point.importance === 'core')) {
      problems.push(`${topic.id} 缺已确认的核心知识点清单。`)
    }
    if (topic.active && !byTopic[topic.id].length) problems.push(`${topic.id} 尚无可发布题目。`)
  }
  if (missingCore.length) problems.push(`有 ${missingCore.length} 个核心知识点尚未覆盖。`)
  if (new Set(ready.map(item => item.knowledgePointId)).size !== ready.length) {
    problems.push('多道发布题共用同一主知识点。')
  }
  for (const [group, value] of Object.entries(stats)) {
    if (value.emotionOnly > Math.floor(value.total * .10)) problems.push(`${group} 情绪线索题超过 10%。`)
    if (value.allSelected > Math.floor(value.multiple * .10)) problems.push(`${group} 多选全选题超过 10%。`)
    const fourSingle = value.byTypeAndOptions['single/4']
    if (fourSingle) {
      for (const counts of [fourSingle.positions, fourSingle.unlockedPositions]) {
        const total = counts.reduce((sum, count) => sum + count, 0)
        if (counts.some(count => count < Math.floor(total / 4) - 1 || count > Math.ceil(total / 4) + 1)) {
          problems.push(`${group} 四选单选答案位置分布超出允许偏差。`)
          break
        }
      }
    }
    const fourMulti = value.byTypeAndOptions['multiple/4']
    if (fourMulti && (group === '_all' || fourMulti.count >= 20)) {
      const partial = fourMulti.count - fourMulti.allSelected
      const hits = fourMulti.positions.reduce((sum, count) => sum + count, 0)
      if (partial && [2, 3].some(size => (fourMulti.answerSizes[size] || 0) / partial < .30)) {
        problems.push(`${group} 四选多选的两项、三项正确题占比须分别达到 30%。`)
      }
      if (fourMulti.count >= 20 && fourMulti.positions.some(count => count / hits < .20 || count / hits > .30)) {
        problems.push(`${group} 四选多选正确位置份额超出 20%–30%。`)
      }
    }
  }
  const candidates = duplicateCandidates(ready)
  const unresolved = new Set()
  for (const candidate of candidates) {
    if (candidate.exact || indexes.duplicateIndex.get(candidate.pair)?.disposition !== 'distinct') unresolved.add(candidate.pair)
  }
  const readyIds = new Set(ready.map(item => item.id))
  for (const [pair, resolution] of indexes.duplicateIndex) {
    if (readyIds.has(resolution.a) && readyIds.has(resolution.b) && resolution.disposition !== 'distinct') unresolved.add(pair)
  }
  if (unresolved.size) problems.push(`有 ${unresolved.size} 个拟发布题对重复或尚未完成去重处置。`)
  return {
    stats,
    coverage: { total: catalog.points.length, covered: covered.size, missingCore, missingGeneral },
    review: { ready: ready.length, draft: catalog.questions.filter(item => item.state === 'draft').length,
      withdrawn: catalog.questions.filter(item => item.state === 'withdrawn').length },
    duplicateCandidates: candidates,
    unresolvedDuplicates: [...unresolved],
    problems,
  }
}

export function makeRelease(catalog, indexes) {
  const published = catalog.questions.filter(item => item.state === 'ready').sort((a, b) => a.id.localeCompare(b.id))
  const questions = published.map(item => {
    const references = item.evidence.concat(item.options.flatMap(option => option.evidence))
    const sources = new Map()
    for (const reference of references) {
      const source = indexes.sourceIndex.get(reference.sourceId)
      sources.set(`${source.id}:${reference.location}`, { title: source.title, url: source.url, location: reference.location })
    }
    return {
      id: item.id, type: item.type, stem: item.stem, topicId: item.topicId,
      contentRevision: questionRevision(item),
      options: item.options.map(({ id, text, rationale }) => ({ id, text, rationale })),
      answerIds: item.answerIds, explanation: item.explanation, sources: [...sources.values()],
    }
  })
  const files = new Map()
  function split(items) {
    const pages = []
    for (let index = 0; index < items.length; index += PAGE_SIZE) {
      const questions = items.slice(index, index + PAGE_SIZE)
      const json = JSON.stringify({
        questions, total: items.length, nextCursor: index + PAGE_SIZE < items.length ? questions.at(-1).id : null,
      }) + '\n'
      const filename = sha256(json) + '.json'
      files.set(filename, json)
      pages.push(`/bank/pages/${filename}`)
    }
    return { total: items.length, pages }
  }
  const topics = catalog.topics.filter(topic => topic.active).map(topic => ({
    ...topic, count: questions.filter(item => item.topicId === topic.id).length,
  }))
  const groups = Object.fromEntries([['_all', split(questions)],
    ...topics.map(topic => [topic.id, split(questions.filter(item => item.topicId === topic.id))])])
  const release = sha256(JSON.stringify({ topics, groups }))
  return { manifest: { release, topics, pageSize: PAGE_SIZE, groups }, files }
}

export async function writeRelease(output, { manifest, files }) {
  const directory = new URL('pages/', output)
  await mkdir(directory, { recursive: true })
  const existing = new Set(await readdir(directory))
  for (const [name, data] of files) {
    if (!existing.has(name)) await writeFile(new URL(name, directory), data, { flag: 'wx' })
  }
  const temporary = new URL('manifest.pending', output)
  await writeFile(temporary, JSON.stringify(manifest) + '\n')
  await rename(temporary, new URL('manifest.json', output))
  for (const name of existing) {
    if (/^[a-f0-9]{64}\.json$/.test(name) && !files.has(name)) await unlink(new URL(name, directory))
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/content/release.mjs')) {
  const command = process.argv[2]
  const catalog = await readCatalog()
  const indexes = validateCatalog(catalog)
  const report = qualityReport(catalog, indexes)
  switch (command) {
    case 'check':
      console.log(JSON.stringify(report.review))
      break
    case 'report':
      console.log(JSON.stringify(report, null, 2))
      break
    case 'build':
      if (process.env.REQUIRE_COMPLETE_BANK === '1' && report.problems.length) {
        throw new Error(report.problems.join('\n'))
      }
      await writeRelease(new URL('../../public/bank/', import.meta.url), makeRelease(catalog, indexes))
      console.log(`CDN 题库已生成，共 ${report.review.ready} 道已复审题。`)
      break
    default:
      throw new Error('Use check, report or build.')
  }
}
