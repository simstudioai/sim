/**
 * Real PostgreSQL coverage for `applyWorkflowSource`: source read with `readWorkflowSource`,
 * edited as text, and written back. Each check reads the stored rows directly, so "nothing was
 * written" means the rows and `updated_at` are byte-identical, not that the use case said so.
 *
 * The concurrent canvas write is forced with the workflow row lock, as the operations conflict
 * suite does: a transaction holds the row, waits until the apply is queued behind it (its base
 * read and gates are done), then writes one subblock the way the realtime server's
 * `persistWorkflowOperation` does under the same lock. That function lives in `apps/realtime`,
 * which `apps/sim` may not import, so its lock-then-update is reproduced here.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db, runOutsideTransactionContext } from '@sim/db'
import {
  auditLog,
  chat,
  permissions,
  user,
  webhook,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowSchedule,
  workflowSourceMeta,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { SOURCE_LIMITS } from '@sim/workflow-code/limits'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import { CONTAINER_DIMENSIONS } from '@sim/workflow-renderer/dimensions'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, sql } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import {
  type ApplyWorkflowSourceInput,
  applyWorkflowSource,
  createWorkflowFromSource,
} from '@/lib/workflows/application/apply-workflow-source'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { WorkflowSourceRejectedError } from '@/lib/workflows/application/source-error'
import {
  loadWorkflowDeploymentSnapshot,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const ownerId = generateId()
const workspaceId = generateId()
const principal = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })

const checks: { name: string; status: string; durationMs: number; error?: string }[] = []

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const started = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

interface Seeded {
  workflowId: string
  startId: string
  scoreId: string
  edgeId: string
  variableId: string
}

const SCORE_CODE = 'return 41 + 1'

async function seedWorkflow(): Promise<Seeded> {
  const workflowId = generateId()
  const startId = generateId()
  const scoreId = generateId()
  const edgeId = generateId()
  const variableId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Source apply ${workflowId}`,
    variables: { [variableId]: { id: variableId, name: 'threshold', type: 'number', value: 3 } },
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const blocks: Record<string, BlockState> = {
    [startId]: {
      id: startId,
      type: 'start_trigger',
      name: 'Start',
      position: { x: 0, y: 0 },
      subBlocks: {},
      outputs: {},
      enabled: true,
    },
    [scoreId]: {
      id: scoreId,
      type: 'function',
      name: 'Score',
      position: { x: 420, y: 80 },
      subBlocks: { code: { id: 'code', type: 'code', value: SCORE_CODE } },
      outputs: {},
      enabled: true,
    },
  }
  const state: WorkflowState = {
    blocks,
    edges: [{ id: edgeId, source: startId, target: scoreId }],
    loops: {},
    parallels: {},
  }
  const saved = await saveWorkflowToNormalizedTables(workflowId, state)
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  return { workflowId, startId, scoreId, edgeId, variableId }
}

type ReadWorkflowSourceResult = Awaited<ReturnType<typeof readWorkflowSource.execute>>

function getSource(workflowId: string): Promise<ReadWorkflowSourceResult> {
  return withPermissionGroupScope(() =>
    readWorkflowSource.execute({ principal, input: { workflowId } })
  )
}

function apply(
  source: Pick<ReadWorkflowSourceResult, 'workflowId' | 'lock' | 'base'>,
  files: Record<string, string>,
  extra: Partial<ApplyWorkflowSourceInput> = {}
) {
  return withPermissionGroupScope(() =>
    applyWorkflowSource.execute({
      principal,
      input: {
        workflowId: source.workflowId,
        files,
        lock: source.lock,
        base: source.base,
        ...extra,
      },
    })
  )
}

/** Replaces the one occurrence of `from` across the source files. */
function edit(files: Record<string, string>, from: string, to: string): Record<string, string> {
  const hits = Object.entries(files).filter(([, text]) => text.split(from).length === 2)
  expect(hits, `exactly one file holds "${from}" once`).toHaveLength(1)
  const [path, text] = hits[0]
  return { ...files, [path]: text.replace(from, to) }
}

interface StoredSnapshot {
  updatedAt: number
  state: Awaited<ReturnType<typeof loadWorkflowFromNormalizedTables>>
  variables: unknown
}

async function snapshot(workflowId: string): Promise<StoredSnapshot> {
  const [row] = await db
    .select({ updatedAt: workflow.updatedAt, variables: workflow.variables })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
  return {
    updatedAt: row.updatedAt.getTime(),
    variables: row.variables,
    state: await loadWorkflowFromNormalizedTables(workflowId),
  }
}

async function applySourceAuditRows(workflowId: string) {
  const rows = await db
    .select({ metadata: auditLog.metadata })
    .from(auditLog)
    .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.resourceId, workflowId)))
  return rows.filter((row) => (row.metadata as { op?: string } | null)?.op === 'apply_source')
}

/** Audit entries are recorded after the use case returns; give the write a moment to land. */
async function settledAuditRows(workflowId: string, expected: number) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rows = await applySourceAuditRows(workflowId)
    if (rows.length >= expected) return rows
    await sleep(50)
  }
  return applySourceAuditRows(workflowId)
}

function notifiedFor(workflowId: string): number {
  return realtimeNotifyMockFns.mockNotifyWorkflowUpdated.mock.calls.filter(
    ([id]) => id === workflowId
  ).length
}

async function expectRejected(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(WorkflowSourceRejectedError)
  const codes = (error as WorkflowSourceRejectedError).diagnostics.map((d) => d.code)
  expect(codes).toContain(code)
  return error as WorkflowSourceRejectedError
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Source apply fixture',
    email: `${ownerId}@source-apply.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Source apply',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
})

afterAll(async () => {
  const reportPath =
    process.env.WORKFLOW_SOURCE_APPLY_REPORT_PATH ??
    resolve('test-results/workflow-source-apply.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
})

check('get → apply unchanged is a no-op that writes, audits and notifies nothing', async () => {
  const seeded = await seedWorkflow()
  const source = await getSource(seeded.workflowId)
  const before = await snapshot(seeded.workflowId)

  const result = await apply(source, source.files)

  expect(result.applied).toBe(false)
  expect(result.diff.noop).toBe(true)
  expect(result.base.fingerprint).toBe(source.base.fingerprint)
  expect(await snapshot(seeded.workflowId)).toEqual(before)
  expect(await settledAuditRows(seeded.workflowId, 0)).toHaveLength(0)
  expect(notifiedFor(seeded.workflowId)).toBe(0)
})

check('create → apply the files it wrote is a no-op for a forEach loop', async () => {
  const created = await withPermissionGroupScope(() =>
    createWorkflowFromSource.execute({
      principal,
      input: {
        workspaceId,
        name: `Source create ${generateId()}`,
        files: {
          'workflow.ts': `// @sim-sdk 1
import { fn, loop, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Each item', {}, () => {
  const start = trigger.start('Start', { inputFormat: { items: 'array' } })
  const each = loop.forEach('Each Item', { collection: start.items }, (item) => {
    const echo = fn('Echo', { code: 'return 1' })
    item.to(echo)
  })
  start.to(each)
})
`,
        },
      },
    })
  )
  expect(created.applied).toBe(true)
  const stored = await loadWorkflowFromNormalizedTables(created.workflowId)
  const loopBlock = Object.values(stored?.blocks ?? {}).find((block) => block.type === 'loop')
  expect(loopBlock?.data?.whileCondition).toBe('')

  const result = await apply(created, created.files, { dryRun: true })

  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  expect(result.diff.blocks.modified).toEqual([])
  expect(result.diff.noop).toBe(true)
})

check('create keeps the function file name the source wrote', async () => {
  const created = await withPermissionGroupScope(() =>
    createWorkflowFromSource.execute({
      principal,
      input: {
        workspaceId,
        name: `Source create ${generateId()}`,
        files: {
          'workflow.ts': `// @sim-sdk 1
import { codeFile, fn, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Normalize', {}, () => {
  const start = trigger.start('Start', { inputFormat: { email: 'string' } })
  const normalize = fn('Normalize Domain', { code: codeFile('./functions/normalize-domain.js') })
  start.to(normalize)
})
`,
          'functions/normalize-domain.js': "return String($ref.start.email ?? '').toLowerCase()\n",
        },
      },
    })
  )

  expect(created.applied).toBe(true)
  expect(Object.keys(created.files).sort()).toEqual([
    'functions/normalize-domain.js',
    'workflow.ts',
  ])
  expect(created.files['workflow.ts']).toContain("codeFile('./functions/normalize-domain.js')")
  expect(Object.values(created.lock.blocks).map((block) => block.codeFile)).toContain(
    'functions/normalize-domain.js'
  )
})

check('a create warns on an env name the workspace and the caller do not hold', async () => {
  const result = await withPermissionGroupScope(() =>
    createWorkflowFromSource.execute({
      principal,
      input: {
        workspaceId,
        name: `Source create ${generateId()}`,
        dryRun: true,
        files: {
          'workflow.ts': `// @sim-sdk 1
import { env, response, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Env', {}, () => {
  const start = trigger.start('Start', {})
  const done = response('Done', { body: { key: env.SOURCE_APPLY_UNSET_KEY } })
  start.to(done)
})
`,
        },
      },
    })
  )

  const unknown = result.diagnostics.filter((d) => d.code === 'W_ENV_UNKNOWN')
  expect(unknown).toHaveLength(1)
  expect(unknown[0]).toMatchObject({ severity: 'warning', file: 'workflow.ts', line: 6 })
})

check('a legacy ~n key block keeps its stored secret through get → apply unchanged', async () => {
  const workflowId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Source apply ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const crawler = (id: string, name: string, secret: string): BlockState => ({
    id,
    type: 'firecrawl',
    name,
    position: { x: 0, y: 0 },
    subBlocks: { apiKey: { id: 'apiKey', type: 'short-input', value: secret } },
    outputs: {},
    enabled: true,
  })
  const winnerId = generateId()
  const loserId = generateId()
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: {
      [winnerId]: crawler(winnerId, 'Crawl 1', 'sk-winner-secret'),
      [loserId]: crawler(loserId, 'crawl1', 'sk-loser-secret'),
    },
    edges: [],
    loops: {},
    parallels: {},
  })
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)

  const source = await getSource(workflowId)
  const printed = Object.values(source.files).join('\n')
  expect(printed).toContain("key: 'crawl1~2'")
  expect(printed).not.toContain('sk-winner-secret')
  expect(printed).not.toContain('sk-loser-secret')
  const before = await snapshot(workflowId)

  const result = await apply(source, source.files)

  expect(result.diagnostics.map((d) => d.code)).not.toContain('E_STORED_VALUE_MISSING')
  expect(result.applied).toBe(false)
  expect(result.diff.noop).toBe(true)
  expect(await snapshot(workflowId)).toEqual(before)
  expect(before.state?.blocks[loserId]?.subBlocks.apiKey?.value).toBe('sk-loser-secret')
})

check('a refusal on a legacy ~n key block points at that block, not its namesake', async () => {
  const workflowId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Source apply ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const fn = (id: string, name: string, code: string, locked: boolean): BlockState => ({
    id,
    type: 'function',
    name,
    position: { x: 0, y: 0 },
    subBlocks: { code: { id: 'code', type: 'code', value: code } },
    outputs: {},
    enabled: true,
    locked,
  })
  const winnerId = generateId()
  const loserId = generateId()
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: {
      [winnerId]: fn(winnerId, 'Score 1', 'return 1', false),
      [loserId]: fn(loserId, 'score1', 'return 2', true),
    },
    edges: [],
    loops: {},
    parallels: {},
  })
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  const source = await getSource(workflowId)
  const files = edit(source.files, 'return 2', 'return 3')

  const error = await expectRejected(apply(source, files), 'E_APPLY_LOCKED_BLOCK')

  const refusal = error.diagnostics.find((d) => d.code === 'E_APPLY_LOCKED_BLOCK')
  expect(refusal).toMatchObject({ blockId: loserId, blockKey: 'score1~2', file: 'workflow.ts' })
  const framed = files['workflow.ts']
    .split('\n')
    .slice((refusal?.line ?? 0) - 1, refusal?.endLine ?? 0)
    .join('\n')
  expect(framed).toContain("'score1~2'")
  expect(framed).not.toContain("'Score 1'")
})

check('a one-field edit changes exactly that stored field and keeps every id', async () => {
  const seeded = await seedWorkflow()
  const source = await getSource(seeded.workflowId)
  const before = await snapshot(seeded.workflowId)

  const result = await apply(source, edit(source.files, SCORE_CODE, 'return 7'))

  expect(result.applied).toBe(true)
  expect(result.diff.blocks.modified.map((block) => block.id)).toEqual([seeded.scoreId])
  const after = await snapshot(seeded.workflowId)
  expect(after.updatedAt).toBeGreaterThan(before.updatedAt)
  expect(after.variables).toEqual(before.variables)
  expect(Object.keys(after.state?.blocks ?? {}).sort()).toEqual(
    [seeded.startId, seeded.scoreId].sort()
  )
  expect(after.state?.edges.map((e) => e.id)).toEqual([seeded.edgeId])
  expect(after.state?.blocks[seeded.startId]).toEqual(before.state?.blocks[seeded.startId])
  const beforeScore = before.state?.blocks[seeded.scoreId]
  const afterScore = after.state?.blocks[seeded.scoreId]
  expect(afterScore?.subBlocks.code?.value).toBe('return 7')
  expect(
    isEqual(
      { ...afterScore, subBlocks: { ...afterScore?.subBlocks, code: undefined } },
      { ...beforeScore, subBlocks: { ...beforeScore?.subBlocks, code: undefined } }
    )
  ).toBe(true)
  expect(result.lock.variables).toEqual(source.lock.variables)
  expect(
    Object.values(result.lock.blocks)
      .map((b) => b.id)
      .sort()
  ).toEqual(
    Object.values(source.lock.blocks)
      .map((b) => b.id)
      .sort()
  )

  const reread = await getSource(seeded.workflowId)
  expect(reread.base.fingerprint).toBe(result.base.fingerprint)
  expect(await settledAuditRows(seeded.workflowId, 1)).toHaveLength(1)
  expect(notifiedFor(seeded.workflowId)).toBe(1)
})

check('a canvas write that commits while the apply waits on the row lock is a 409', async () => {
  const seeded = await seedWorkflow()
  const source = await getSource(seeded.workflowId)
  let outcome: Promise<unknown> = Promise.resolve()
  let settled = false

  await db.transaction(async (tx) => {
    const [self] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
    await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, seeded.workflowId))
      .for('update')
    outcome = runOutsideTransactionContext(() =>
      apply(source, edit(source.files, SCORE_CODE, 'return 8')).finally(() => {
        settled = true
      })
    )
    await waitForBlocked(Number(self?.pid), () => settled)
    await canvasSubBlockWrite(tx, seeded.scoreId, 'return 9')
  })

  await expect(outcome).rejects.toMatchObject({ code: 'conflict' })
  const after = await snapshot(seeded.workflowId)
  expect(after.state?.blocks[seeded.scoreId]?.subBlocks.code?.value).toBe('return 9')
})

check(
  'a canvas write the fingerprint ignores, committed under the row lock, is a 409 and is kept',
  async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    let outcome: Promise<unknown> = Promise.resolve()
    let settled = false

    await db.transaction(async (tx) => {
      const [self] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      await tx
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.id, seeded.workflowId))
        .for('update')
      outcome = runOutsideTransactionContext(() =>
        apply(source, edit(source.files, SCORE_CODE, 'return 8')).finally(() => {
          settled = true
        })
      )
      await waitForBlocked(Number(self?.pid), () => settled)
      await canvasSubBlockSet(tx, seeded.scoreId, 'triggerPath', 'kept-webhook-path')
    })

    await expect(outcome).rejects.toMatchObject({ code: 'conflict' })
    const after = await snapshot(seeded.workflowId)
    const score = after.state?.blocks[seeded.scoreId]
    expect(score?.subBlocks.triggerPath?.value).toBe('kept-webhook-path')
    expect(score?.subBlocks.code?.value).toBe(SCORE_CODE)
  }
)

check('a canvas drag committed under the row lock survives the apply', async () => {
  const seeded = await seedWorkflow()
  const source = await getSource(seeded.workflowId)
  let outcome: Promise<unknown> = Promise.resolve()
  let settled = false

  await db.transaction(async (tx) => {
    const [self] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
    await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, seeded.workflowId))
      .for('update')
    outcome = runOutsideTransactionContext(() =>
      apply(source, edit(source.files, SCORE_CODE, 'return 8')).finally(() => {
        settled = true
      })
    )
    await waitForBlocked(Number(self?.pid), () => settled)
    await tx
      .update(workflowBlocks)
      .set({ positionX: '777', positionY: '333' })
      .where(eq(workflowBlocks.id, seeded.scoreId))
  })

  await expect(outcome).resolves.toMatchObject({ applied: true })
  const after = await snapshot(seeded.workflowId)
  expect(after.state?.blocks[seeded.scoreId]?.position).toEqual({ x: 777, y: 333 })
  expect(after.state?.blocks[seeded.scoreId]?.subBlocks.code?.value).toBe('return 8')
})

check(
  'a canvas handle flip committed under the row lock survives the apply, like a drag',
  async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    let outcome: Promise<unknown> = Promise.resolve()
    let settled = false

    await db.transaction(async (tx) => {
      const [self] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      await tx
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.id, seeded.workflowId))
        .for('update')
      outcome = runOutsideTransactionContext(() =>
        apply(source, edit(source.files, SCORE_CODE, 'return 8')).finally(() => {
          settled = true
        })
      )
      await waitForBlocked(Number(self?.pid), () => settled)
      await tx
        .update(workflowBlocks)
        .set({ horizontalHandles: false })
        .where(eq(workflowBlocks.id, seeded.scoreId))
    })

    await expect(outcome).resolves.toMatchObject({ applied: true })
    const after = await snapshot(seeded.workflowId)
    expect(after.state?.blocks[seeded.scoreId]?.horizontalHandles).toBe(false)
    expect(after.state?.blocks[seeded.scoreId]?.subBlocks.code?.value).toBe('return 8')
  }
)

check('a block added to a loop stores the loop resized by the targeted layout', async () => {
  const workflowId = generateId()
  const ids = { start: generateId(), loop: generateId(), inner: generateId() }
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Source apply ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const base = (id: string, type: string, name: string): BlockState => ({
    id,
    type,
    name,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
  })
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: {
      [ids.start]: base(ids.start, 'start_trigger', 'Start'),
      [ids.loop]: {
        ...base(ids.loop, 'loop', 'Each'),
        position: { x: 400, y: 0 },
        data: { width: 100, height: 100 },
      },
      [ids.inner]: {
        ...base(ids.inner, 'function', 'Inner'),
        position: { x: 50, y: 50 },
        subBlocks: { code: { id: 'code', type: 'code', value: 'return 1' } },
        data: { parentId: ids.loop, extent: 'parent' },
      },
    },
    edges: [
      { id: generateId(), source: ids.start, target: ids.loop },
      {
        id: generateId(),
        source: ids.loop,
        target: ids.inner,
        sourceHandle: 'loop-start-source',
      },
    ],
    loops: {},
    parallels: {},
  })
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  const source = await getSource(workflowId)
  const innerIdent = source.lock.blocks.inner.ident
  const workflowFile = source.files['workflow.ts']
  const innerLine = new RegExp(`\\n(\\s*)const ${innerIdent} = [^\\n]*\\n`)
  expect(workflowFile).toMatch(innerLine)

  const result = await apply(source, {
    ...source.files,
    'workflow.ts': workflowFile.replace(innerLine, (line, indent: string) => {
      const extra = line
        .trim()
        .replace(`const ${innerIdent} =`, 'const extra =')
        .replace("'Inner'", "'Extra'")
      return `${line}${indent}${extra}\n${indent}${innerIdent}.to(extra)\n`
    }),
  })

  expect(result.applied).toBe(true)
  const after = await snapshot(workflowId)
  const extraId = result.mintedIds.extra
  expect(after.state?.blocks[extraId]?.data?.parentId).toBe(ids.loop)
  const loop = after.state?.blocks[ids.loop]
  expect(loop?.data?.width).toBeGreaterThanOrEqual(CONTAINER_DIMENSIONS.DEFAULT_WIDTH)
  expect(loop?.data?.height).toBeGreaterThanOrEqual(CONTAINER_DIMENSIONS.DEFAULT_HEIGHT)
})

check('a block lock toggled between get and apply is a 409', async () => {
  const seeded = await seedWorkflow()
  const source = await getSource(seeded.workflowId)
  await db.update(workflowBlocks).set({ locked: true }).where(eq(workflowBlocks.id, seeded.startId))

  await expect(apply(source, edit(source.files, SCORE_CODE, 'return 10'))).rejects.toMatchObject({
    code: 'conflict',
    currentFingerprint: expect.stringMatching(/^sf1:/),
  })
})

check('editing a locked block is refused with diagnostics and writes nothing', async () => {
  const seeded = await seedWorkflow()
  await db.update(workflowBlocks).set({ locked: true }).where(eq(workflowBlocks.id, seeded.scoreId))
  const source = await getSource(seeded.workflowId)
  const before = await snapshot(seeded.workflowId)

  const error = await expectRejected(
    apply(source, edit(source.files, SCORE_CODE, 'return 11')),
    'E_APPLY_LOCKED_BLOCK'
  )

  expect(error.code).toBe('validation')
  expect(error.diagnostics.find((d) => d.code === 'E_APPLY_LOCKED_BLOCK')?.blockId).toBe(
    seeded.scoreId
  )
  expect(await snapshot(seeded.workflowId)).toEqual(before)
  expect(await settledAuditRows(seeded.workflowId, 0)).toHaveLength(0)
})

check('a canvas drag between get and apply survives an edit', async () => {
  const seeded = await seedWorkflow()
  const source = await getSource(seeded.workflowId)
  await db
    .update(workflowBlocks)
    .set({ positionX: '999', positionY: '555' })
    .where(eq(workflowBlocks.id, seeded.scoreId))

  const result = await apply(source, edit(source.files, SCORE_CODE, 'return 12'))

  expect(result.applied).toBe(true)
  const after = await snapshot(seeded.workflowId)
  expect(after.state?.blocks[seeded.scoreId]?.position).toEqual({ x: 999, y: 555 })
  expect(after.state?.blocks[seeded.startId]?.position).toEqual({ x: 0, y: 0 })
})

check('a rename keeps the block id, so a webhook row bound to it stays valid', async () => {
  const seeded = await seedWorkflow()
  const webhookId = generateId()
  await db.insert(webhook).values({
    id: webhookId,
    workflowId: seeded.workflowId,
    blockId: seeded.scoreId,
    path: `source-apply-${webhookId}`,
  })
  const source = await getSource(seeded.workflowId)
  const workflowFile = source.files['workflow.ts']
  expect(workflowFile.split("'Score'")).toHaveLength(2)

  const result = await apply(source, {
    ...source.files,
    'workflow.ts': workflowFile.replace("'Score'", "'Scorer'"),
  })

  expect(result.applied).toBe(true)
  expect(result.diff.blocks.renamed).toEqual([{ id: seeded.scoreId, from: 'score', to: 'scorer' }])
  const after = await snapshot(seeded.workflowId)
  expect(after.state?.blocks[seeded.scoreId]?.name).toBe('Scorer')
  const [row] = await db
    .select({ blockId: webhook.blockId })
    .from(webhook)
    .where(eq(webhook.id, webhookId))
  expect(after.state?.blocks[row.blockId ?? '']).toBeDefined()
})

check(
  'an apply stores its idents, order and comments in source meta, and the next get prints them',
  async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    const scoreIdent = source.lock.blocks.score.ident
    const renamed = source.files['workflow.ts']
      .replace(new RegExp(`(?<![\\w/])${scoreIdent}(?![\\w]|\\.js)`, 'g'), 'scoring')
      .replace(/(\n\s*)const scoring = /, '$1// kept across reads$1const scoring = ')

    const result = await apply(source, { ...source.files, 'workflow.ts': renamed })

    expect(result.lock.blocks.score.ident).toBe('scoring')
    const [row] = await db
      .select({ meta: workflowSourceMeta.meta })
      .from(workflowSourceMeta)
      .where(eq(workflowSourceMeta.workflowId, seeded.workflowId))
    expect(row.meta).toMatchObject({ version: 1, idents: { [seeded.scoreId]: 'scoring' } })
    const again = await getSource(seeded.workflowId)
    expect(again.lock.blocks.score.ident).toBe('scoring')
    expect(again.files['workflow.ts']).toContain('const scoring = ')
    expect(again.files['workflow.ts']).toContain('// kept across reads')
    expect(again.base.fingerprint).toBe(result.base.fingerprint)
  }
)

check('a workspace API key is refused before anything is read', async () => {
  const seeded = await seedWorkflow()
  const source = await getSource(seeded.workflowId)

  await expect(
    withPermissionGroupScope(() =>
      applyWorkflowSource.execute({
        principal: createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() }),
        input: {
          workflowId: seeded.workflowId,
          files: source.files,
          lock: source.lock,
          base: source.base,
        },
      })
    )
  ).rejects.toMatchObject({ code: 'forbidden' })
})

check('a dry run reports the outcome and never writes', async () => {
  const seeded = await seedWorkflow()
  const source = await getSource(seeded.workflowId)
  const before = await snapshot(seeded.workflowId)

  const result = await apply(source, edit(source.files, SCORE_CODE, 'return 13'), {
    dryRun: true,
  })

  expect(result.dryRun).toBe(true)
  expect(result.applied).toBe(false)
  expect(result.diff.blocks.modified.map((block) => block.id)).toEqual([seeded.scoreId])
  expect(result.base.fingerprint).not.toBe(source.base.fingerprint)
  expect(await snapshot(seeded.workflowId)).toEqual(before)
  expect(await settledAuditRows(seeded.workflowId, 0)).toHaveLength(0)
  expect(notifiedFor(seeded.workflowId)).toBe(0)
})

check('a dry run with a compile error answers with line-pinned diagnostics', async () => {
  const seeded = await seedWorkflow()
  const source = await getSource(seeded.workflowId)

  const result = await apply(
    source,
    { ...source.files, 'workflow.ts': `${source.files['workflow.ts']}\nconst = \n` },
    { dryRun: true }
  )

  const error = result.diagnostics.find((d) => d.severity === 'error')
  expect(error?.file).toBe('workflow.ts')
  expect(error?.line).toBeGreaterThan(1)
})

/** The realtime server's subblock write: one block's `sub_blocks` under the held row lock. */
async function canvasSubBlockWrite(tx: DbOrTx, blockId: string, code: string) {
  const [row] = await tx
    .select({ subBlocks: workflowBlocks.subBlocks })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.id, blockId))
  const subBlocks = row.subBlocks as Record<string, { value: unknown }>
  await tx
    .update(workflowBlocks)
    .set({ subBlocks: { ...subBlocks, code: { ...subBlocks.code, value: code } } })
    .where(eq(workflowBlocks.id, blockId))
}

/** A realtime subblock write of a value the source fingerprint ignores, such as `triggerPath`. */
async function canvasSubBlockSet(tx: DbOrTx, blockId: string, subBlockId: string, value: string) {
  const [row] = await tx
    .select({ subBlocks: workflowBlocks.subBlocks })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.id, blockId))
  const subBlocks = row.subBlocks as Record<string, unknown>
  await tx
    .update(workflowBlocks)
    .set({
      subBlocks: { ...subBlocks, [subBlockId]: { id: subBlockId, type: 'short-input', value } },
    })
    .where(eq(workflowBlocks.id, blockId))
}

/** Waits until a session is queued behind the holder; throws if the apply settles first. */
function waitForBlocked(holderPid: number, settled: () => boolean): Promise<void> {
  return runOutsideTransactionContext(async () => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (settled()) throw new Error('The apply finished before reaching the row lock')
      const [row] = await db.execute<{ blocked: number }>(sql`
        SELECT count(*)::int AS blocked FROM pg_stat_activity
        WHERE ${holderPid} = ANY(pg_blocking_pids(pid))`)
      if ((row?.blocked ?? 0) >= 1) return
      await sleep(25)
    }
    throw new Error(`Expected a session blocked behind backend ${holderPid}`)
  })
}

/**
 * Edge cases of the write itself (polish phase E2): the base names its workflow, the workflow lock
 * and the source-meta-only write are re-checked under the row lock, a removed block with a live
 * deployment warns, and refusals reach analytics.
 */
describe('apply edges: identity, row lock, live triggers', () => {
  /** Renames the Score block's ident: a graph no-op that changes only source meta. */
  function renameScoreIdent(source: ReadWorkflowSourceResult): Record<string, string> {
    const ident = source.lock.blocks.score.ident
    return {
      ...source.files,
      'workflow.ts': source.files['workflow.ts'].replace(
        new RegExp(`(?<![\\w/])${ident}(?![\\w]|\\.js)`, 'g'),
        'scoring'
      ),
    }
  }

  /** Drops the Score block: every line naming its ident, and its function file. */
  function deleteScore(source: ReadWorkflowSourceResult): Record<string, string> {
    const ident = source.lock.blocks.score.ident
    const mentions = new RegExp(`(?<![\\w/])${ident}(?![\\w])`)
    const files = Object.fromEntries(
      Object.entries(source.files).filter(([path]) => !path.startsWith('functions/'))
    )
    return {
      ...files,
      'workflow.ts': source.files['workflow.ts']
        .split('\n')
        .filter((line) => !mentions.test(line))
        .join('\n'),
    }
  }

  async function storedSourceMeta(workflowId: string) {
    const [row] = await db
      .select({ meta: workflowSourceMeta.meta })
      .from(workflowSourceMeta)
      .where(eq(workflowSourceMeta.workflowId, workflowId))
    return row?.meta ?? null
  }

  check('a base read from another workflow is refused with 400 and writes nothing', async () => {
    const [target, other] = await Promise.all([seedWorkflow(), seedWorkflow()])
    const otherSource = await getSource(other.workflowId)
    const before = await snapshot(target.workflowId)

    const error = await expectRejected(
      apply(
        { ...otherSource, workflowId: target.workflowId },
        edit(otherSource.files, SCORE_CODE, 'return 20')
      ),
      'E_APPLY_WORKFLOW_MISMATCH'
    )

    expect(error.code).toBe('validation')
    expect(await snapshot(target.workflowId)).toEqual(before)
    expect(await settledAuditRows(target.workflowId, 0)).toHaveLength(0)
  })

  check('a workflow locked while the apply waits on the row lock refuses it with 423', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    let outcome: Promise<unknown> = Promise.resolve()
    let settled = false

    await db.transaction(async (tx) => {
      const [self] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      await tx
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.id, seeded.workflowId))
        .for('update')
      outcome = runOutsideTransactionContext(() =>
        apply(source, edit(source.files, SCORE_CODE, 'return 21')).finally(() => {
          settled = true
        })
      )
      await waitForBlocked(Number(self?.pid), () => settled)
      await tx.update(workflow).set({ locked: true }).where(eq(workflow.id, seeded.workflowId))
    })

    await expect(outcome).rejects.toMatchObject({ code: 'locked' })
    const after = await snapshot(seeded.workflowId)
    expect(after.state?.blocks[seeded.scoreId]?.subBlocks.code?.value).toBe(SCORE_CODE)
  })

  check(
    'a source-meta-only apply queues on the row lock and refuses a draft that moved meanwhile',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const metaBefore = await storedSourceMeta(seeded.workflowId)
      let outcome: Promise<unknown> = Promise.resolve()
      let settled = false

      await db.transaction(async (tx) => {
        const [self] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        await tx
          .select({ id: workflow.id })
          .from(workflow)
          .where(eq(workflow.id, seeded.workflowId))
          .for('update')
        outcome = runOutsideTransactionContext(() =>
          apply(source, renameScoreIdent(source)).finally(() => {
            settled = true
          })
        )
        await waitForBlocked(Number(self?.pid), () => settled)
        await canvasSubBlockWrite(tx, seeded.scoreId, 'return 22')
      })

      await expect(outcome).rejects.toMatchObject({ code: 'conflict' })
      expect(await storedSourceMeta(seeded.workflowId)).toEqual(metaBefore)
    }
  )

  check('a source-meta-only apply stores the meta and notifies open Code tabs', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    const before = await snapshot(seeded.workflowId)

    const result = await apply(source, renameScoreIdent(source))

    expect(result.applied).toBe(false)
    expect(result.lock.blocks.score.ident).toBe('scoring')
    expect(await storedSourceMeta(seeded.workflowId)).toMatchObject({
      idents: { [seeded.scoreId]: 'scoring' },
    })
    expect(await snapshot(seeded.workflowId)).toEqual(before)
    expect(notifiedFor(seeded.workflowId)).toBe(1)
    expect(await settledAuditRows(seeded.workflowId, 0)).toHaveLength(0)
  })

  check(
    'deleting a block the live deployment serves warns with its webhook, schedule and chat output',
    async () => {
      const seeded = await seedWorkflow()
      const versionId = generateId()
      await db.insert(workflowDeploymentVersion).values({
        id: versionId,
        workflowId: seeded.workflowId,
        version: 1,
        state: {},
        isActive: true,
      })
      await db.insert(webhook).values({
        id: generateId(),
        workflowId: seeded.workflowId,
        deploymentVersionId: versionId,
        blockId: seeded.scoreId,
        path: `source-live-${generateId()}`,
      })
      await db.insert(workflowSchedule).values({
        id: generateId(),
        workflowId: seeded.workflowId,
        deploymentVersionId: versionId,
        blockId: seeded.scoreId,
        triggerType: 'schedule',
      })
      await db.insert(chat).values({
        id: generateId(),
        workflowId: seeded.workflowId,
        userId: ownerId,
        identifier: `source-live-${generateId()}`,
        title: 'Live chat',
        outputConfigs: [{ blockId: seeded.scoreId, path: 'result' }],
      })
      const source = await getSource(seeded.workflowId)

      const result = await apply(source, deleteScore(source))

      expect(result.applied).toBe(true)
      expect(result.diff.blocks.removed.map((block) => block.id)).toEqual([seeded.scoreId])
      const warning = result.diagnostics.find((d) => d.code === 'W_APPLY_TRIGGER_REMOVED')
      expect(warning).toMatchObject({ severity: 'warning', blockId: seeded.scoreId })
      expect(warning?.message).toContain('webhook, schedule, chat output')
      expect(warning?.message).toContain('only the draft')
    }
  )

  check('the same delete with no active deployment carries no live-trigger warning', async () => {
    const seeded = await seedWorkflow()
    await db.insert(webhook).values({
      id: generateId(),
      workflowId: seeded.workflowId,
      blockId: seeded.scoreId,
      path: `source-draft-${generateId()}`,
    })
    const source = await getSource(seeded.workflowId)

    const result = await apply(source, deleteScore(source))

    expect(result.applied).toBe(true)
    expect(result.diagnostics.map((d) => d.code)).not.toContain('W_APPLY_TRIGGER_REMOVED')
  })

  check('a stale apply by a personal key is recorded as a refused apply', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    await db
      .update(workflowBlocks)
      .set({ locked: true })
      .where(eq(workflowBlocks.id, seeded.startId))

    await expect(
      withPermissionGroupScope(() =>
        applyWorkflowSource.execute({
          principal: createPersonalApiKeyPrincipal({ userId: ownerId, keyId: generateId() }),
          input: {
            workflowId: seeded.workflowId,
            files: edit(source.files, SCORE_CODE, 'return 23'),
            lock: source.lock,
            base: source.base,
            provenance: { client: 'cli' },
          },
        })
      )
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(posthogServerMockFns.mockCaptureServerEvent).toHaveBeenCalledWith(
      ownerId,
      'workflow_source_applied',
      expect.objectContaining({
        workflow_id: seeded.workflowId,
        source: 'cli',
        ok: false,
        error_kind: 'stale',
      }),
      { groups: { workspace: workspaceId } }
    )
  })
})

/**
 * Edge cases the apply handles. Each case names the bug it catches; the shared helpers above are
 * reused, and everything this block adds lives in it.
 */
describe('source apply edge cases', () => {
  const readerId = generateId()
  const reader = createSessionPrincipal({ userId: readerId, sessionId: generateId() })

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: readerId,
      name: 'Source apply reader',
      email: `${readerId}@source-apply.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId: readerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'read',
    })
  })

  afterAll(async () => {
    await db.delete(permissions).where(eq(permissions.userId, readerId))
    await db.delete(user).where(eq(user.id, readerId))
  })

  type SubBlockSeed = Record<string, [type: string, value: unknown]>

  function seedBlock(type: string, name: string, subBlocks: SubBlockSeed = {}): BlockState {
    return {
      id: generateId(),
      type,
      name,
      position: { x: 0, y: 0 },
      subBlocks: Object.fromEntries(
        Object.entries(subBlocks).map(([key, [subType, value]]) => [
          key,
          { id: key, type: subType, value },
        ])
      ) as BlockState['subBlocks'],
      outputs: {},
      enabled: true,
    }
  }

  /** A workflow whose first block feeds every other block. */
  async function seedGraph(blocks: BlockState[]): Promise<string> {
    const workflowId = generateId()
    const now = new Date()
    await db.insert(workflow).values({
      id: workflowId,
      userId: ownerId,
      workspaceId,
      name: `Source apply edge ${workflowId}`,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    const [first, ...rest] = blocks
    const saved = await saveWorkflowToNormalizedTables(workflowId, {
      blocks: Object.fromEntries(blocks.map((block) => [block.id, block])),
      edges: rest.map((block) => ({ id: generateId(), source: first.id, target: block.id })),
      loops: {},
      parallels: {},
    })
    if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
    return workflowId
  }

  /** Function code printed inline, so a field written next to `code` stays in `workflow.ts`. */
  function getInlineSource(workflowId: string): Promise<ReadWorkflowSourceResult> {
    return withPermissionGroupScope(() =>
      readWorkflowSource.execute({ principal, input: { workflowId, functionCode: 'inline' } })
    )
  }

  /** Declares one more block in `workflow.ts`, unwired, under the given lock entry. */
  function withExtraBlock(source: ReadWorkflowSourceResult, lockId: string) {
    const files = edit(
      source.files,
      '  start.to(score)',
      "  const extra = fn('Extra', { code: 'return 2' })\n  start.to(score)"
    )
    const lock = {
      ...source.lock,
      blocks: {
        ...source.lock.blocks,
        extra: { id: lockId, parent: null, ident: 'extra', order: 99 },
      },
    }
    return { files, lock }
  }

  async function storedName(workflowId: string): Promise<string> {
    const [row] = await db
      .select({ name: workflow.name })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
    return row.name
  }

  /**
   * Holds the workflow row lock, starts the applies outside the holder's transaction, waits until
   * every one is queued behind the holder (their base reads and gates are done), runs the
   * concurrent write under the lock, then releases it. Returns how each apply settled.
   */
  async function raceUnderRowLock(
    workflowId: string,
    start: () => Promise<unknown>[],
    concurrentWrite: (tx: DbOrTx) => Promise<void> = async () => {}
  ): Promise<PromiseSettledResult<unknown>[]> {
    let outcomes: Promise<PromiseSettledResult<unknown>[]> = Promise.resolve([])
    let settledCount = 0
    await db.transaction(async (tx) => {
      const [self] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      await tx
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .for('update')
      const started = runOutsideTransactionContext(() =>
        start().map((pending) =>
          pending.finally(() => {
            settledCount += 1
          })
        )
      )
      outcomes = Promise.allSettled(started)
      await waitForQueued(Number(self?.pid), started.length, () => settledCount > 0)
      await concurrentWrite(tx)
    })
    return outcomes
  }

  /**
   * Waits until `count` sessions queue behind the holder; throws if an apply settles first. A
   * second waiter on the same row queues on the first waiter's tuple lock, so Postgres reports it
   * blocked by that waiter, not by the holder: the queue is followed transitively.
   */
  function waitForQueued(holderPid: number, count: number, settled: () => boolean): Promise<void> {
    return runOutsideTransactionContext(async () => {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (settled()) throw new Error('An apply finished before reaching the row lock')
        const [row] = await db.execute<{ blocked: number }>(sql`
          WITH RECURSIVE queued(pid) AS (
            SELECT pid FROM pg_stat_activity
            WHERE datname = current_database() AND ${holderPid}::int = ANY(pg_blocking_pids(pid))
            UNION
            SELECT activity.pid FROM pg_stat_activity AS activity
            JOIN queued ON queued.pid = ANY(pg_blocking_pids(activity.pid))
            WHERE activity.datname = current_database()
          )
          SELECT count(*)::int AS blocked FROM queued`)
        if ((row?.blocked ?? 0) >= count) return
        await sleep(25)
      }
      throw new Error(`Expected ${count} sessions blocked behind backend ${holderPid}`)
    })
  }

  function rejection(outcome: PromiseSettledResult<unknown> | undefined): unknown {
    return outcome?.status === 'rejected' ? outcome.reason : null
  }

  check(
    'a canvas drag between get and apply leaves an unchanged source a no-op that writes nothing',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      await db
        .update(workflowBlocks)
        .set({ positionX: '640', positionY: '320' })
        .where(eq(workflowBlocks.id, seeded.scoreId))
      const before = await snapshot(seeded.workflowId)

      const result = await apply(source, source.files)

      expect(result.applied).toBe(false)
      expect(result.diff.noop).toBe(true)
      expect(await snapshot(seeded.workflowId)).toEqual(before)
      expect(before.state?.blocks[seeded.scoreId]?.position).toEqual({ x: 640, y: 320 })
      expect(await settledAuditRows(seeded.workflowId, 0)).toHaveLength(0)
      expect(notifiedFor(seeded.workflowId)).toBe(0)
    }
  )

  check('an invalid value on a changed field refuses the apply and writes nothing', async () => {
    const start = seedBlock('start_trigger', 'Start')
    const score = seedBlock('function', 'Score', { code: ['code', 'return 1'] })
    const workflowId = await seedGraph([start, score])
    const source = await getInlineSource(workflowId)
    const before = await snapshot(workflowId)

    const error = await expectRejected(
      apply(source, edit(source.files, 'language: null', "language: 'cobol'")),
      'E_APPLY_INVALID_SUBBLOCK_FIELD'
    )

    expect(
      error.diagnostics.find((d) => d.code === 'E_APPLY_INVALID_SUBBLOCK_FIELD')
    ).toMatchObject({ blockId: score.id, param: 'language' })
    expect(await snapshot(workflowId)).toEqual(before)
  })

  check(
    'a value the field normalizes is stored normalized, and untouched blocks keep their bytes',
    async () => {
      const start = seedBlock('start_trigger', 'Start')
      const writer = seedBlock('agent', 'Writer', {
        model: ['combobox', 'gpt-4o'],
        temperature: ['slider', 0.5],
        messages: ['messages-input', [{ role: 'user', content: 'hi' }]],
      })
      const score = seedBlock('function', 'Score', { code: ['code', 'return 1'] })
      const workflowId = await seedGraph([start, writer, score])
      const source = await getInlineSource(workflowId)
      const before = await snapshot(workflowId)

      const result = await apply(source, edit(source.files, 'temperature: 0.5', 'temperature: 7'))

      expect(result.applied).toBe(true)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'W_APPLY_VALUE_NORMALIZED',
          blockId: writer.id,
          param: 'temperature',
        })
      )
      const after = await snapshot(workflowId)
      expect(after.state?.blocks[writer.id]?.subBlocks.temperature?.value).toBe(2)
      expect(after.state?.blocks[score.id]).toEqual(before.state?.blocks[score.id])
      expect(after.state?.blocks[start.id]).toEqual(before.state?.blocks[start.id])
    }
  )

  check(
    'a structural lint finding refuses only a block the apply changed; an untouched one warns',
    async () => {
      const start = seedBlock('start_trigger', 'Start')
      const score = seedBlock('function', 'Score', { code: ['code', 'return 1'] })
      const other = seedBlock('function', 'Other', { code: ['code', 'return <nope.x>'] })
      const workflowId = await seedGraph([start, score, other])
      const source = await getInlineSource(workflowId)
      const before = await snapshot(workflowId)

      const error = await expectRejected(
        apply(source, edit(source.files, 'js`return 1`', "'return <ghost.value>'")),
        'E_APPLY_LINT'
      )

      const lint = error.diagnostics.filter((d) => d.code.endsWith('_APPLY_LINT'))
      const refusedBlocks = lint.filter((d) => d.code === 'E_APPLY_LINT').map((d) => d.blockId)
      expect(new Set(refusedBlocks)).toEqual(new Set([score.id]))
      expect(lint).toContainEqual(
        expect.objectContaining({ code: 'W_APPLY_LINT', blockId: other.id })
      )
      expect(await snapshot(workflowId)).toEqual(before)
    }
  )

  check(
    'a workflow name edited in source is not applied and the note points at settings',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const name = await storedName(seeded.workflowId)
      const before = await snapshot(seeded.workflowId)

      const result = await apply(source, edit(source.files, `'${name}'`, "'Renamed in source'"))

      expect(result.applied).toBe(false)
      expect(result.diff.noop).toBe(true)
      expect(result.notes).toContainEqual(expect.stringContaining('through its settings'))
      expect(await storedName(seeded.workflowId)).toBe(name)
      expect(await snapshot(seeded.workflowId)).toEqual(before)
    }
  )

  check(
    'a lock read in another workspace is stale, so its id for a vanished block is not reused',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const lockId = generateId()
      const { files, lock } = withExtraBlock(source, lockId)

      const fresh = await apply(source, files, { lock, dryRun: true })
      const stale = await apply(source, files, {
        lock,
        base: { ...source.base, workspaceId: generateId() },
        dryRun: true,
      })

      expect(fresh.mintedIds).toEqual({})
      expect(fresh.lock.blocks.extra?.id).toBe(lockId)
      expect(fresh.diagnostics.map((d) => d.code)).not.toContain('W_MAT_DELETED_SINCE_PULL')
      expect(stale.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'W_MAT_DELETED_SINCE_PULL', blockKey: 'extra' })
      )
      expect(stale.mintedIds.extra).toBeDefined()
      expect(stale.mintedIds.extra).not.toBe(lockId)
    }
  )

  check('a lock id another workflow already stores is dropped and a new id is minted', async () => {
    const target = await seedWorkflow()
    const other = await seedWorkflow()
    const source = await getSource(target.workflowId)
    const { files, lock } = withExtraBlock(source, other.scoreId)

    const result = await apply(source, files, { lock })

    expect(result.applied).toBe(true)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'W_MAT_LOCK_ID_CLAIMED', blockKey: 'extra' })
    )
    const minted = result.mintedIds.extra
    expect(minted).toBeDefined()
    expect(minted).not.toBe(other.scoreId)
    const after = await snapshot(target.workflowId)
    expect(after.state?.blocks[minted ?? '']?.name).toBe('Extra')
    const [claimed] = await db
      .select({ workflowId: workflowBlocks.workflowId })
      .from(workflowBlocks)
      .where(eq(workflowBlocks.id, other.scoreId))
    expect(claimed.workflowId).toBe(other.workflowId)
  })

  check(
    'two applies racing on one base write once; the other answers 409 under the row lock',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const edits = ['return 31', 'return 32']

      const outcomes = await raceUnderRowLock(seeded.workflowId, () =>
        edits.map((code) => apply(source, edit(source.files, SCORE_CODE, code)))
      )

      const fulfilled = outcomes.flatMap((outcome, index) =>
        outcome.status === 'fulfilled' ? [index] : []
      )
      expect(fulfilled).toHaveLength(1)
      expect(rejection(outcomes.find((o) => o.status === 'rejected'))).toMatchObject({
        code: 'conflict',
      })
      const after = await snapshot(seeded.workflowId)
      expect(after.state?.blocks[seeded.scoreId]?.subBlocks.code?.value).toBe(edits[fulfilled[0]])
      expect(await settledAuditRows(seeded.workflowId, 1)).toHaveLength(1)
    }
  )

  check(
    'a canvas rename that commits while the apply waits is a 409 and the block keeps its id',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)

      const [outcome] = await raceUnderRowLock(
        seeded.workflowId,
        () => [apply(source, edit(source.files, SCORE_CODE, 'return 41'))],
        async (tx) => {
          await tx
            .update(workflowBlocks)
            .set({ name: 'Scorer' })
            .where(eq(workflowBlocks.id, seeded.scoreId))
        }
      )

      expect(rejection(outcome)).toMatchObject({ code: 'conflict' })
      const after = await snapshot(seeded.workflowId)
      expect(after.state?.blocks[seeded.scoreId]?.name).toBe('Scorer')
      expect(after.state?.blocks[seeded.scoreId]?.subBlocks.code?.value).toBe(SCORE_CODE)
    }
  )

  check(
    'a stored value a migration rewrote between get and apply moves the fingerprint: 409',
    async () => {
      const start = seedBlock('start_trigger', 'Start')
      const writer = seedBlock('agent', 'Writer', {
        model: ['combobox', 'gpt-4o'],
        messages: ['messages-input', [{ role: 'user', content: 'hi' }]],
      })
      const workflowId = await seedGraph([start, writer])
      const source = await getInlineSource(workflowId)
      const [row] = await db
        .select({ subBlocks: workflowBlocks.subBlocks })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.id, writer.id))
      const subBlocks = row.subBlocks as Record<string, { value: unknown }>
      await db
        .update(workflowBlocks)
        .set({ subBlocks: { ...subBlocks, model: { ...subBlocks.model, value: 'gpt-4.1' } } })
        .where(eq(workflowBlocks.id, writer.id))
      const before = await snapshot(workflowId)

      await expect(
        apply(source, edit(source.files, "content: 'hi'", "content: 'hello'"))
      ).rejects.toMatchObject({
        code: 'conflict',
        currentFingerprint: expect.stringMatching(/^sf1:/),
      })
      expect(await snapshot(workflowId)).toEqual(before)
    }
  )

  check('a workflow archived while the apply waits on the row lock answers not found', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)

    const [outcome] = await raceUnderRowLock(
      seeded.workflowId,
      () => [apply(source, edit(source.files, SCORE_CODE, 'return 51'))],
      async (tx) => {
        await tx
          .update(workflow)
          .set({ archivedAt: new Date() })
          .where(eq(workflow.id, seeded.workflowId))
      }
    )

    expect(rejection(outcome)).toMatchObject({ code: 'not_found' })
    const after = await snapshot(seeded.workflowId)
    expect(after.state?.blocks[seeded.scoreId]?.subBlocks.code?.value).toBe(SCORE_CODE)
  })

  check('a dry run against a stale base answers 200 with E_APPLY_STALE', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    await canvasSubBlockWrite(db, seeded.scoreId, 'return 61')
    const before = await snapshot(seeded.workflowId)

    const result = await apply(source, edit(source.files, SCORE_CODE, 'return 62'), {
      dryRun: true,
    })

    expect(result.dryRun).toBe(true)
    expect(result.applied).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'E_APPLY_STALE', severity: 'error' })
    )
    expect(result.base.fingerprint).toBe(source.base.fingerprint)
    expect(await snapshot(seeded.workflowId)).toEqual(before)
  })

  check('applying with the base a stale dry run returned still answers 409', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    await canvasSubBlockWrite(db, seeded.scoreId, 'return 63')
    const files = edit(source.files, SCORE_CODE, 'return 64')
    const preview = await apply(source, files, { dryRun: true })
    const before = await snapshot(seeded.workflowId)

    await expect(
      apply(
        { workflowId: source.workflowId, lock: preview.lock, base: preview.base },
        preview.files
      )
    ).rejects.toMatchObject({ name: 'WorkflowSourceStaleError', code: 'conflict' })
    expect(files).toEqual(preview.files)
    expect(await snapshot(seeded.workflowId)).toEqual(before)
    expect(before.state?.blocks[seeded.scoreId]?.subBlocks.code?.value).toBe('return 63')
  })

  check('a workspace member with read access is refused and nothing is written', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    const before = await snapshot(seeded.workflowId)

    await expect(
      withPermissionGroupScope(() =>
        applyWorkflowSource.execute({
          principal: reader,
          input: {
            workflowId: seeded.workflowId,
            files: edit(source.files, SCORE_CODE, 'return 71'),
            lock: source.lock,
            base: source.base,
          },
        })
      )
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await snapshot(seeded.workflowId)).toEqual(before)
  })

  check(
    'a schedule edited in source changes only the draft and reports needsRedeployment',
    async () => {
      const schedule = seedBlock('schedule', 'Every day', {
        scheduleType: ['dropdown', 'daily'],
        dailyTime: ['time-input', '09:00'],
        timezone: ['dropdown', 'UTC'],
      })
      const score = seedBlock('function', 'Score', { code: ['code', 'return 1'] })
      const workflowId = await seedGraph([schedule, score])
      const deployed = await loadWorkflowDeploymentSnapshot(workflowId)
      if (!deployed) throw new Error('The seeded draft has no deployment snapshot')
      const versionId = generateId()
      await db.insert(workflowDeploymentVersion).values({
        id: versionId,
        workflowId,
        version: 1,
        state: deployed,
        isActive: true,
      })
      await db.update(workflow).set({ isDeployed: true }).where(eq(workflow.id, workflowId))
      const nextRunAt = new Date('2030-01-01T09:00:00.000Z')
      await db.insert(workflowSchedule).values({
        id: generateId(),
        workflowId,
        deploymentVersionId: versionId,
        blockId: schedule.id,
        cronExpression: '0 9 * * *',
        nextRunAt,
        triggerType: 'schedule',
        timezone: 'UTC',
      })
      const source = await getSource(workflowId)

      const unchanged = await apply(source, source.files)
      const result = await apply(source, edit(source.files, "'09:00'", "'10:30'"))

      expect(unchanged.needsRedeployment).toBe(false)
      expect(result.applied).toBe(true)
      expect(result.needsRedeployment).toBe(true)
      const after = await snapshot(workflowId)
      expect(after.state?.blocks[schedule.id]?.subBlocks.dailyTime?.value).toBe('10:30')
      const [scheduleRow] = await db
        .select({
          cronExpression: workflowSchedule.cronExpression,
          nextRunAt: workflowSchedule.nextRunAt,
        })
        .from(workflowSchedule)
        .where(eq(workflowSchedule.workflowId, workflowId))
      expect(scheduleRow).toEqual({ cronExpression: '0 9 * * *', nextRunAt })
      const [version] = await db
        .select({ state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.id, versionId))
      expect(version.state).toEqual(deployed)
    }
  )

  check(
    'a committed apply records one audit row carrying the client, git sha and counts',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)

      const result = await apply(source, edit(source.files, SCORE_CODE, 'return 81'), {
        provenance: { client: 'cli', gitSha: '0123abcd' },
      })

      const rows = await settledAuditRows(seeded.workflowId, 1)
      expect(rows).toHaveLength(1)
      expect(rows[0].metadata).toMatchObject({
        op: 'apply_source',
        client: 'cli',
        gitSha: '0123abcd',
        blocksAdded: 0,
        blocksRemoved: 0,
        blocksModified: 1,
        sdkMajor: result.sdkMajor,
        catalogHash: result.base.catalogHash,
      })
    }
  )

  check('the workflow-code flag turned off between get and apply refuses the apply', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    const before = await snapshot(seeded.workflowId)
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async () => false)
    try {
      await expect(
        apply(source, edit(source.files, SCORE_CODE, 'return 91'))
      ).rejects.toMatchObject({ code: 'forbidden' })
    } finally {
      featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
        async (flag: string) => flag === 'workflow-code'
      )
    }
    expect(await snapshot(seeded.workflowId)).toEqual(before)
  })

  check('a get of a workflow over the block limit answers 413 before printing', async () => {
    const blocks = Array.from({ length: SOURCE_LIMITS.maxBlocks + 1 }, (_, i) =>
      seedBlock(i === 0 ? 'start_trigger' : 'function', i === 0 ? 'Start' : `Step ${i}`)
    )
    const workflowId = await seedGraph(blocks)

    await expect(getSource(workflowId)).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  check('a get of a workflow nested past the depth cap answers 413', async () => {
    let body: unknown = 1
    for (let level = 0; level < 120; level++) body = { a: body }
    const workflowId = await seedGraph([
      seedBlock('start_trigger', 'Start'),
      seedBlock('api', 'Deep', {
        url: ['short-input', 'https://example.com'],
        body: ['code', JSON.stringify(body, null, 2)],
      }),
    ])

    await expect(getSource(workflowId)).rejects.toMatchObject({
      code: 'payload_too_large',
      message: expect.stringContaining('too deeply nested'),
    })
  })

  check('source over the byte limit is refused with 413 and nothing is written', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    const before = await snapshot(seeded.workflowId)
    const oversized = `return '${'x'.repeat(SOURCE_LIMITS.maxTotalBytes)}'`

    const error = await expectRejected(
      apply(source, edit(source.files, SCORE_CODE, oversized)),
      'E_LIMIT_EXCEEDED'
    )

    expect(error.code).toBe('payload_too_large')
    expect(await snapshot(seeded.workflowId)).toEqual(before)
  })
})
