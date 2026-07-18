const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { randomBytes } = require('node:crypto')
const { basename, join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

require('reflect-metadata')

const tempRoot = resolve(mkdtempSync(join(tmpdir(), 'terra-resource-sync-')))
process.env.TERRA_RESOURCE_FILE = join(tempRoot, 'resources.json')
process.env.TERRA_RESOURCE_SYNC_FILE = join(tempRoot, 'resource-sync.json')
process.env.TERRA_DATA_ENCRYPTION_KEY = randomBytes(32).toString('hex')

const { ResourcesService } = require('../dist/resources/resources.service')

let tasks = [task('task-a', 'first-unique'), task('task-b', 'orphaned-needle')]
let xiaomiScenario = 'initial'
let detailFetches = 0
let lastRequestedCursor
const CURSOR_PAGE_1 = '60000000000000001'
const CURSOR_FULL_1 = '60000000000000002'
const CURSOR_INCREMENTAL = '60000000000000003'
const CURSOR_FULL_2 = '60000000000000004'
const CURSOR_CONFLICT = '60000000000000005'
const CURSOR_REGRESSION = '60000000000000006'
const CURSOR_NO_CHANGE = '60000000000000007'
const CURSOR_EMPTY = '60000000000000008'

const tasksService = { findAll: async () => structuredClone(tasks) }
const metadataService = { findAll: async () => [] }
const xiaomiNotesService = {
  async findPage({ cursor }) {
    lastRequestedCursor = cursor
    if (xiaomiScenario === 'initial') {
      return cursor
        ? { notes: [note('50993292568436801', 'beta-orphan', 201)], folders: [], syncCursor: CURSOR_FULL_1, lastPage: true, cached: false }
        : { notes: [note('50993292568436800', 'alpha-sentinel', 200)], folders: [], syncCursor: CURSOR_PAGE_1, nextCursor: CURSOR_PAGE_1, lastPage: false, cached: false }
    }
    if (xiaomiScenario === 'incremental') {
      assert(cursor === CURSOR_FULL_1, 'incremental sync did not start from the persisted full cursor')
      return { notes: [note('50993292568436800', 'alpha-updated', 300), note('50993292568436802', 'gamma-added', 301)], folders: [], syncCursor: CURSOR_INCREMENTAL, lastPage: true, cached: false }
    }
    if (xiaomiScenario === 'reduced') {
      assert(cursor === undefined, 'full sync unexpectedly reused an incremental cursor')
      return { notes: [note('50993292568436800', 'alpha-updated', 300), note('50993292568436802', 'gamma-added', 301)], folders: [], syncCursor: CURSOR_FULL_2, lastPage: true, cached: false }
    }
    if (xiaomiScenario === 'conflict') {
      assert(cursor === CURSOR_FULL_2, 'conflict sync did not start from the latest full cursor')
      return { notes: [note('50993292568436800', 'alpha-conflicting-version', 300)], folders: [], syncCursor: CURSOR_CONFLICT, lastPage: true, cached: false }
    }
    if (xiaomiScenario === 'regression') {
      assert(cursor === CURSOR_CONFLICT, 'regression sync did not start from the conflict cursor')
      return { notes: [note('50993292568436800', 'alpha-regressed-version', 299)], folders: [], syncCursor: CURSOR_REGRESSION, lastPage: true, cached: false }
    }
    if (xiaomiScenario === 'no-change') {
      assert(cursor === CURSOR_REGRESSION, 'restarted service did not reuse the persisted cursor')
      return { notes: [], folders: [], syncCursor: CURSOR_NO_CHANGE, lastPage: true, cached: false }
    }
    if (xiaomiScenario === 'recover') {
      assert(cursor === CURSOR_NO_CHANGE, 'failed sync advanced or cleared the persisted cursor')
      return { notes: [], folders: [], syncCursor: CURSOR_NO_CHANGE, lastPage: true, cached: false }
    }
    if (xiaomiScenario === 'broken') {
      return { notes: [note('50993292568436800', 'should-not-commit', 400)], folders: [], syncCursor: cursor, nextCursor: cursor, lastPage: false, cached: false }
    }
    return { notes: [], folders: [], syncCursor: CURSOR_EMPTY, lastPage: true, cached: false }
  },
  async findOne(id) {
    detailFetches += 1
    const isAlpha = id.endsWith('800')
    const isGamma = id.endsWith('802')
    const title = isAlpha
      ? xiaomiScenario === 'conflict' ? 'alpha-conflicting-version' : xiaomiScenario === 'regression' ? 'alpha-regressed-version' : xiaomiScenario === 'initial' ? 'alpha-sentinel' : 'alpha-updated'
      : isGamma ? 'gamma-added' : 'beta-orphan'
    const modifyDate = isAlpha ? xiaomiScenario === 'initial' ? 200 : xiaomiScenario === 'regression' ? 299 : 300 : isGamma ? 301 : 201
    return { ...note(id, title, modifyDate), content: `${title} private body` }
  }
}

async function main() {
  const service = new ResourcesService(tasksService, xiaomiNotesService, metadataService)

  await service.syncTasks()
  tasks = [task('task-a', 'first-unique')]
  const taskRemoval = await service.syncTasks()
  assert(taskRemoval.removed === 1, 'removed task did not create one tombstone')
  assert((await service.search('orphaned-needle')).length === 0, 'task tombstone leaked into search')
  await expectStatus(() => service.findOne('terra:task:task-b'), 404)

  tasks = [task('task-a', 'first-unique'), task('task-b', 'restored-needle')]
  await service.syncTasks()
  assert((await service.search('restored-needle')).length === 1, 'restored source did not replace its tombstone')
  assert((await service.search('first-unique', { project: 'test', fromDate: '2026-07-15', toDate: '2026-07-15' })).length === 1, 'task project/date context filter failed')

  await service.replaceSourceResources('travel', 'trip', [contextResource()])
  const contextual = await service.search('museum-marker', {
    source: 'travel',
    tag: 'culture',
    project: 'weekend',
    location: 'shanghai',
    fromDate: '2026-08-02',
    toDate: '2026-08-02'
  })
  assert(contextual.length === 1 && contextual[0].context.locations[0].latitude === 31.2304, 'unified Resource context filter failed')
  await expectStatus(() => service.search('museum-marker', { fromDate: '2026-08-03', toDate: '2026-08-01' }), 400)
  await expectStatus(() => service.replaceSourceResources('travel', 'trip', [{ ...contextResource(), context: { projects: [], locations: [{ name: 'bad', latitude: 10 }] } }]), 400)

  const initialNotes = await service.syncXiaomiNotes('auto')
  assert(initialNotes.mode === 'full' && initialNotes.indexed === 2 && detailFetches === 2, 'initial Xiaomi sync did not complete a full detail scan')
  const initialStatus = await service.getStatus()
  assert(initialStatus.syncCheckpoints[0].cursorPresent && initialStatus.syncCheckpoints[0].lastMode === 'full', 'full sync cursor was not persisted')
  assert(!JSON.stringify(initialStatus).includes(CURSOR_FULL_1), 'Resource status exposed the raw sync cursor')

  xiaomiScenario = 'incremental'
  const incrementalNotes = await service.syncXiaomiNotes()
  assert(incrementalNotes.mode === 'incremental' && incrementalNotes.removed === 0 && incrementalNotes.fetchedDetails === 2, 'incremental sync mode or detail fetch count is incorrect')
  assert((await service.search('beta-orphan')).length === 1, 'incremental sync treated an omitted item as deleted')
  assert((await service.search('alpha-updated')).length === 1 && (await service.search('gamma-added')).length === 1, 'incremental upsert did not index changed and new notes')

  xiaomiScenario = 'reduced'
  const reducedNotes = await service.syncXiaomiNotes('full')
  assert(reducedNotes.mode === 'full' && reducedNotes.removed === 1 && reducedNotes.fetchedDetails === 0, 'full deletion scan or unchanged detail reuse is incorrect')
  assert((await service.search('beta-orphan')).length === 0, 'Xiaomi tombstone leaked into search')

  xiaomiScenario = 'conflict'
  const conflictResult = await service.syncXiaomiNotes('incremental')
  assert(conflictResult.conflicts === 1, 'same-revision divergence did not record a conflict version')
  assert((await service.search('alpha-conflicting-version')).length === 0, 'unresolved incoming conflict replaced the current Resource')
  const conflictSummaries = await service.findConflicts()
  assert(conflictSummaries.length === 1 && conflictSummaries[0].reason === 'same_revision_diverged', 'conflict summary is missing or has the wrong reason')
  assert(!('content' in conflictSummaries[0].current) && !('content' in conflictSummaries[0].incoming) && !('currentFingerprint' in conflictSummaries[0]), 'conflict list leaked full bodies or internal fingerprints')
  const conflictDetail = await service.findConflict(conflictSummaries[0].id)
  assert(conflictDetail.current.content.includes('alpha-updated') && conflictDetail.incoming.content.includes('alpha-conflicting-version') && !('currentFingerprint' in conflictDetail), 'conflict detail did not preserve both versions or exposed an internal fingerprint')
  const resolvedConflict = await service.resolveConflict(conflictDetail.id, 'accept_incoming')
  assert(resolvedConflict.status === 'resolved' && resolvedConflict.resolution === 'accept_incoming', 'conflict resolution was not persisted')
  assert((await service.search('alpha-conflicting-version')).length === 1, 'accepted incoming conflict version was not indexed')

  xiaomiScenario = 'regression'
  const regressionResult = await service.syncXiaomiNotes('incremental')
  assert(regressionResult.conflicts === 1, 'regressed source revision did not record a conflict version')
  const regressionConflicts = await service.findConflicts()
  assert(regressionConflicts.length === 1 && regressionConflicts[0].reason === 'source_revision_regressed', 'source regression conflict reason is incorrect')
  await service.resolveConflict(regressionConflicts[0].id, 'keep_current')
  assert((await service.search('alpha-conflicting-version')).length === 1 && (await service.search('alpha-regressed-version')).length === 0, 'keep-current resolution changed the indexed version')

  const restarted = new ResourcesService(tasksService, xiaomiNotesService, metadataService)
  const restartedStatus = await restarted.getStatus()
  assert(restartedStatus.syncCheckpoints[0].cursorPresent && restartedStatus.conflictCount === 2 && restartedStatus.unresolvedConflictCount === 0, 'cursor or resolved conflicts did not survive service reconstruction')
  xiaomiScenario = 'no-change'
  const resumed = await restarted.syncXiaomiNotes()
  assert(resumed.mode === 'incremental' && resumed.indexed === 0 && resumed.removed === 0 && lastRequestedCursor === CURSOR_REGRESSION, 'restarted incremental sync did not resume from the persisted cursor')

  const beforeBroken = readFileSync(process.env.TERRA_RESOURCE_FILE, 'utf8')
  xiaomiScenario = 'broken'
  await expectStatus(() => restarted.syncXiaomiNotes(), 502)
  assert(readFileSync(process.env.TERRA_RESOURCE_FILE, 'utf8') === beforeBroken, 'incomplete pagination modified the index')
  xiaomiScenario = 'recover'
  const recovered = await restarted.syncXiaomiNotes()
  assert(recovered.mode === 'incremental' && lastRequestedCursor === CURSOR_NO_CHANGE, 'failed sync did not preserve the last completed cursor')

  xiaomiScenario = 'empty'
  await expectStatus(() => restarted.syncXiaomiNotes('full'), 502)
  assert(readFileSync(process.env.TERRA_RESOURCE_FILE, 'utf8') === beforeBroken, 'empty scan modified a non-empty Xiaomi index')

  const status = await restarted.getStatus()
  const encrypted = readFileSync(process.env.TERRA_RESOURCE_FILE, 'utf8')
  const encryptedSync = readFileSync(process.env.TERRA_RESOURCE_SYNC_FILE, 'utf8')
  assert(status.resourceCount === 5 && status.tombstoneCount === 1 && status.contextCoverage === status.storedResourceCount, 'active, tombstone, or context coverage counts are incorrect')
  assert(status.xiaomiSync.state === 'failed', 'failed Xiaomi sync is not observable')
  assert(!encrypted.includes('private body') && !encrypted.includes('restored-needle'), 'Resource store leaked plaintext')
  assert(!encryptedSync.includes('private body') && !encryptedSync.includes(CURSOR_NO_CHANGE), 'Resource sync store leaked a cursor or conflict body')
  assert(status.syncStorage.encryptedAtRest && !JSON.stringify(status.syncCheckpoints).includes(CURSOR_NO_CHANGE), 'sync storage encryption or cursor redaction is incorrect')

  console.log(JSON.stringify({
    taskTombstone: true,
    tombstoneReplacedOnRestore: true,
    xiaomiDetailsFetched: detailFetches,
    unchangedDetailsReused: true,
    persistentIncrementalCursor: true,
    incrementalOmissionPreserved: true,
    conflictVersions: true,
    conflictResolution: true,
    incompletePaginationProtected: true,
    emptyScanProtected: true,
    contextFilters: true,
    invalidContextRejected: true,
    activeResources: status.resourceCount,
    tombstones: status.tombstoneCount,
    encryptedAtRest: true
  }, null, 2))
}

function task(id, title) {
  return { id, title, category: 'test', date: '2026-07-15', priority: 'Medium', notes: `${title} notes`, completed: false }
}

function note(id, title, modifyDate) {
  return {
    id,
    tag: id,
    title,
    preview: `${title} preview`,
    createDate: 100,
    modifyDate,
    colorId: 0,
    folderId: '0',
    status: 'normal',
    hasRichFormatting: false
  }
}

function contextResource() {
  return {
    id: 'travel:trip:11111111-1111-4111-8111-111111111111',
    type: 'trip',
    source: 'travel',
    sourceId: '11111111-1111-4111-8111-111111111111',
    title: 'museum-marker',
    summary: 'Shanghai museum-marker',
    content: 'museum-marker private itinerary',
    tags: ['culture'],
    privacy: 'private',
    context: {
      projects: ['Weekend project'],
      time: { startDate: '2026-08-01', endDate: '2026-08-03', timezone: 'Asia/Shanghai' },
      locations: [{ name: 'Shanghai Museum', address: 'Shanghai', latitude: 31.2304, longitude: 121.4737 }]
    },
    archived: false,
    deleted: false,
    createdAt: 100,
    updatedAt: 200,
    indexedAt: 300,
    metadata: {}
  }
}

async function expectStatus(work, status) {
  try {
    await work()
  } catch (error) {
    if (typeof error.getStatus === 'function' && error.getStatus() === status) return
    throw error
  }
  throw new Error(`Expected HTTP exception ${status}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function cleanup() {
  const tempBase = resolve(tmpdir())
  if (!tempRoot.startsWith(`${tempBase}\\`) && !tempRoot.startsWith(`${tempBase}/`)) return
  if (!basename(tempRoot).startsWith('terra-resource-sync-')) return
  rmSync(tempRoot, { recursive: true, force: true })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(cleanup)
