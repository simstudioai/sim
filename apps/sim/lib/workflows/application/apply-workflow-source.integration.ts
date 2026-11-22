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
import type { Principal } from '@sim/auth/principal'
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
  workflowEdges,
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
import { isRecordLike, omit } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { SOURCE_LIMITS } from '@sim/workflow-code/limits'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import { CONTAINER_DIMENSIONS } from '@sim/workflow-renderer/dimensions'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, sql } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { createTableUseCase } from '@/lib/table/application/tables'
import {
  type ApplyWorkflowSourceInput,
  applyWorkflowSource,
  createWorkflowFromSource,
  planWorkflowSource,
} from '@/lib/workflows/application/apply-workflow-source'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { WorkflowSourceRejectedError } from '@/lib/workflows/application/source-error'
import {
  type PendingResource,
  PlanBindingError,
  type PlannedSource,
  workflowSourceUpdate,
} from '@/lib/workflows/application/source-pipeline'
import { updateWorkflow } from '@/lib/workflows/application/update-workflow'
import {
  loadWorkflowDeploymentSnapshot,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { claimResourceKey } from '@/lib/workspaces/resource-keys'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
/** The real check, counted: a dry run that changes the draft must not load its deployment twice. */
const draftDeploymentChecks = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/lib/workflows/deployment-status', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workflows/deployment-status')>()
  return {
    ...actual,
    checkNeedsRedeployment: (workflowId: string) => {
      draftDeploymentChecks.count += 1
      return actual.checkNeedsRedeployment(workflowId)
    },
  }
})

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

/** The 1-based line and column where `needle` first starts in `text`. */
function positionOf(text: string, needle: string): { line: number; column: number } {
  const index = text.indexOf(needle)
  expect(index, `the text holds "${needle}"`).toBeGreaterThanOrEqual(0)
  const before = text.slice(0, index)
  return { line: before.split('\n').length, column: index - before.lastIndexOf('\n') }
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

check(
  'a literal secret in a password field warns on create, get and a dry run, never printed',
  async () => {
    const agentSource = (apiKey: string) => `// @sim-sdk 1
import { agent, env, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Secret', {}, () => {
  const start = trigger.start('Start', {})
  const answer = agent('Answer', { model: 'gpt-4o', messages: [], apiKey: ${apiKey} })
  start.to(answer)
})
`
    const secrets = (diagnostics: ReadonlyArray<{ code: string; param?: string }>) =>
      diagnostics.filter((d) => d.code === 'W_LITERAL_SECRET').map((d) => d.param)
    const created = await withPermissionGroupScope(() =>
      createWorkflowFromSource.execute({
        principal,
        input: {
          workspaceId,
          name: `Source create ${generateId()}`,
          files: { 'workflow.ts': agentSource("'placeholder-not-a-real-key'") },
        },
      })
    )
    expect(created.applied).toBe(true)
    expect(secrets(created.diagnostics)).toEqual(['apiKey'])

    const source = await getSource(created.workflowId)
    expect(source.files['workflow.ts']).toContain('apiKey: stored()')
    expect(Object.values(source.files).join('\n')).not.toContain('placeholder-not-a-real-key')
    expect(secrets(source.diagnostics)).toEqual(['apiKey'])
    const dryRun = await apply(source, source.files, { dryRun: true })
    expect(secrets(dryRun.diagnostics)).toEqual(['apiKey'])

    const fixed = await apply(
      source,
      edit(source.files, 'apiKey: stored()', 'apiKey: env.OPENAI_API_KEY'),
      { dryRun: true }
    )
    expect(secrets(fixed.diagnostics)).toEqual([])
  }
)

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
  // Stored blocks load in heap order; only a dotted name loses its key in every order.
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: {
      [winnerId]: crawler(winnerId, 'crawl1', 'sk-winner-secret'),
      [loserId]: crawler(loserId, 'Crawl.1', 'sk-loser-secret'),
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
  // Stored blocks load in heap order; only a dotted name loses its key in every order.
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: {
      [winnerId]: fn(winnerId, 'score1', 'return 1', false),
      [loserId]: fn(loserId, 'Score.1', 'return 2', true),
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
      .set({ updatedAt: new Date(), positionX: '777', positionY: '333' })
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
        .set({ updatedAt: new Date(), horizontalHandles: false })
        .where(eq(workflowBlocks.id, seeded.scoreId))
    })

    await expect(outcome).resolves.toMatchObject({ applied: true })
    const after = await snapshot(seeded.workflowId)
    expect(after.state?.blocks[seeded.scoreId]?.horizontalHandles).toBe(false)
    expect(after.state?.blocks[seeded.scoreId]?.subBlocks.code?.value).toBe('return 8')
  }
)

check(
  'an edge row rewritten unchanged while the apply waits on the row lock is no change',
  async () => {
    const seeded = await seedWorkflow()
    const otherId = generateId()
    await db.insert(workflowBlocks).values({
      id: otherId,
      workflowId: seeded.workflowId,
      type: 'function',
      name: 'Other',
      positionX: '0',
      positionY: '240',
      subBlocks: { code: { id: 'code', type: 'code', value: 'return 0' } },
    })
    await db.insert(workflowEdges).values({
      id: generateId(),
      workflowId: seeded.workflowId,
      sourceBlockId: seeded.startId,
      targetBlockId: otherId,
    })
    const source = await getSource(seeded.workflowId)
    const [firstRead] = await db
      .select({ id: workflowEdges.id })
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, seeded.workflowId))
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
      // An in-place rewrite moves the row to the end of the heap, so the edges read reorders.
      await tx
        .update(workflowEdges)
        .set({ targetHandle: sql`${workflowEdges.targetHandle}` })
        .where(eq(workflowEdges.id, firstRead.id))
    })

    await expect(outcome).resolves.toMatchObject({ applied: true })
    const after = await snapshot(seeded.workflowId)
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
  await db
    .update(workflowBlocks)
    .set({ updatedAt: new Date(), locked: true })
    .where(eq(workflowBlocks.id, seeded.startId))

  await expect(apply(source, edit(source.files, SCORE_CODE, 'return 10'))).rejects.toMatchObject({
    code: 'conflict',
    currentFingerprint: expect.stringMatching(/^sf1:/),
  })
})

check('editing a locked block is refused with diagnostics and writes nothing', async () => {
  const seeded = await seedWorkflow()
  await db
    .update(workflowBlocks)
    .set({ updatedAt: new Date(), locked: true })
    .where(eq(workflowBlocks.id, seeded.scoreId))
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
    .set({ updatedAt: new Date(), positionX: '999', positionY: '555' })
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
  expect(result.applied).toBe(false)
  expect(result.diff.noop).toBe(false)
})

check(
  "a responding child's result.<key> is a warning naming result.data.<key>, not a refusal",
  async () => {
    const childId = generateId()
    const childStartId = generateId()
    const replyId = generateId()
    const now = new Date()
    await db.insert(workflow).values({
      id: childId,
      userId: ownerId,
      workspaceId,
      name: `Responder ${childId}`,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    const child = await saveWorkflowToNormalizedTables(childId, {
      blocks: {
        [childStartId]: {
          id: childStartId,
          type: 'start_trigger',
          name: 'Start',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
        [replyId]: {
          id: replyId,
          type: 'response',
          name: 'Reply',
          position: { x: 400, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
      edges: [{ id: generateId(), source: childStartId, target: replyId }],
      loops: {},
      parallels: {},
    })
    if (!child.success) throw new Error(`Seeding the child failed: ${child.error}`)
    const seeded = await seedWorkflow()
    const callId = generateId()
    const stored = await loadWorkflowFromNormalizedTables(seeded.workflowId)
    if (!stored) throw new Error('The seeded workflow did not load')
    const saved = await saveWorkflowToNormalizedTables(seeded.workflowId, {
      ...stored,
      blocks: {
        ...stored.blocks,
        [callId]: {
          id: callId,
          type: 'workflow_input',
          name: 'Call',
          position: { x: 200, y: 40 },
          subBlocks: {
            workflowId: { id: 'workflowId', type: 'workflow-selector', value: childId },
          },
          outputs: {},
          enabled: true,
        },
      },
      edges: [
        { id: generateId(), source: seeded.startId, target: callId },
        { id: seeded.edgeId, source: callId, target: seeded.scoreId },
      ],
    })
    if (!saved.success) throw new Error(`Adding the call failed: ${saved.error}`)
    const source = await getSource(seeded.workflowId)

    const result = await apply(
      source,
      edit(source.files, SCORE_CODE, 'return $ref.call.result.mobile'),
      {
        dryRun: true,
      }
    )

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'W_APPLY_LINT',
        blockKey: 'score',
        message: expect.stringContaining('Did you mean <call.result.data.mobile>?'),
      })
    )
  }
)

check('a new block of an unknown type is one error, at its source line', async () => {
  const seeded = await seedWorkflow()
  const source = await getSource(seeded.workflowId)
  const added = edit(
    source.files,
    '  start.to(score)',
    "  const ghost = block('qa_nonexistent_type', 'Ghost', {})\n  start.to(score)\n  score.to(ghost)"
  )
  const files = {
    ...added,
    'workflow.ts': added['workflow.ts'].replace(/import \{ /, 'import { block, '),
  }

  const result = await apply(source, files, { dryRun: true })

  const errors = result.diagnostics.filter((d) => d.severity === 'error')
  expect(errors.map((d) => d.code)).toEqual(['E_APPLY_INVALID_BLOCK_TYPE'])
  const ghostLine =
    files['workflow.ts']
      .split('\n')
      .findIndex((line) => line.includes("block('qa_nonexistent_type'")) + 1
  expect(ghostLine).toBeGreaterThan(0)
  expect(errors[0]).toMatchObject({ file: 'workflow.ts', line: ghostLine, blockKey: 'ghost' })
  expect(errors[0]?.message).toContain('qa_nonexistent_type')
  expect(result.applied).toBe(false)
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
    .set({
      updatedAt: new Date(),
      subBlocks: { ...subBlocks, code: { ...subBlocks.code, value: code } },
    })
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
      updatedAt: new Date(),
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

      const result = await apply(source, deleteScore(source), { allowDelete: true })

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

    const result = await apply(source, deleteScore(source), { allowDelete: true })

    expect(result.applied).toBe(true)
    expect(result.diagnostics.map((d) => d.code)).not.toContain('W_APPLY_TRIGGER_REMOVED')
  })

  check('a stale apply by a personal key is recorded as a refused apply', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    await db
      .update(workflowBlocks)
      .set({ updatedAt: new Date(), locked: true })
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
  check(
    'a plan (a workspace plan or dry run) of a locked workflow records nothing; its commit records the refusal',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      await db.update(workflow).set({ locked: true }).where(eq(workflow.id, seeded.workflowId))
      const run = (extra: Partial<ApplyWorkflowSourceInput>) =>
        withPermissionGroupScope(() =>
          applyWorkflowSource.execute({
            principal: createPersonalApiKeyPrincipal({ userId: ownerId, keyId: generateId() }),
            input: {
              workflowId: seeded.workflowId,
              files: edit(source.files, SCORE_CODE, 'return 24'),
              lock: source.lock,
              base: source.base,
              provenance: { client: 'cli' },
              ...extra,
            },
          })
        )
      const recorded = () =>
        posthogServerMockFns.mockCaptureServerEvent.mock.calls.filter(
          ([, , properties]) =>
            isRecordLike(properties) && properties.workflow_id === seeded.workflowId
        )

      await expect(
        withPermissionGroupScope(() =>
          workflowSourceUpdate.plan.execute({
            principal: createPersonalApiKeyPrincipal({ userId: ownerId, keyId: generateId() }),
            input: {
              workflowId: seeded.workflowId,
              files: edit(source.files, SCORE_CODE, 'return 24'),
              lock: source.lock,
              base: source.base,
              allowDelete: false,
              pendingResources: [],
              loads: {},
            },
          })
        )
      ).rejects.toMatchObject({ code: 'locked' })
      expect(recorded()).toEqual([])

      await expect(run({})).rejects.toMatchObject({ code: 'locked' })
      expect(recorded().map(([, event, properties]) => [event, properties])).toEqual([
        ['workflow_source_applied', expect.objectContaining({ ok: false, error_kind: 'locked' })],
      ])
    }
  )
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
        .set({ updatedAt: new Date(), positionX: '640', positionY: '320' })
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

    const refusals = error.diagnostics.filter((d) => d.code === 'E_APPLY_INVALID_SUBBLOCK_FIELD')
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({ blockId: score.id, param: 'language' })
    expect(error.diagnostics.map((d) => d.code)).not.toContain('W_UNKNOWN_OPTION')
    expect(await snapshot(workflowId)).toEqual(before)
  })

  check(
    'an edited block keeps a value outside its options the stored block already holds',
    async () => {
      const start = seedBlock('start_trigger', 'Start')
      const score = seedBlock('function', 'Score', {
        code: ['code', 'return 1'],
        language: ['dropdown', 'cobol'],
      })
      const workflowId = await seedGraph([start, score])
      const source = await getInlineSource(workflowId)

      const result = await apply(source, edit(source.files, 'return 1', 'return 2'))

      expect(result.applied).toBe(true)
      const stored = (await snapshot(workflowId)).state?.blocks[score.id]
      expect(stored?.subBlocks.code?.value).toBe('return 2')
      expect(stored?.subBlocks.language?.value).toBe('cobol')
    }
  )

  check(
    "an edited block's stored out-of-options value written bare again is not refused: the edit does not set that field",
    async () => {
      const start = seedBlock('start_trigger', 'Start')
      const score = seedBlock('function', 'Score', {
        code: ['code', 'return 1'],
        language: ['dropdown', 'cobol'],
      })
      const workflowId = await seedGraph([start, score])
      const source = await getInlineSource(workflowId)

      const result = await apply(
        source,
        edit(
          edit(source.files, "language: raw('cobol')", "language: 'cobol'"),
          'return 1',
          'return 2'
        )
      )

      expect(result.applied).toBe(true)
      expect(result.diagnostics.map((d) => d.code)).not.toContain('E_APPLY_INVALID_SUBBLOCK_FIELD')
      const after = await snapshot(workflowId)
      expect(after.state?.blocks[score.id]?.subBlocks.language?.value).toBe('cobol')
    }
  )

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
    'a dangling reference refuses only a block the apply changed, at compile as an offline check does',
    async () => {
      const start = seedBlock('start_trigger', 'Start')
      const score = seedBlock('function', 'Score', { code: ['code', 'return 1'] })
      const other = seedBlock('function', 'Other', { code: ['code', 'return <nope.x>'] })
      const workflowId = await seedGraph([start, score, other])
      const source = await getInlineSource(workflowId)
      const before = await snapshot(workflowId)

      const error = await expectRejected(
        apply(source, edit(source.files, 'js`return 1`', "'return <ghost.value>'")),
        'E_APPLY_UNRESOLVED_REF'
      )

      const refused = error.diagnostics.filter((d) => d.severity === 'error')
      expect(refused.map((d) => [d.code, d.blockKey])).toEqual([
        ['E_APPLY_UNRESOLVED_REF', 'score'],
      ])
      expect(await snapshot(workflowId)).toEqual(before)
    }
  )

  check(
    'a workflow name and description edited in source rename the workflow, and a get reads them back unchanged',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const name = await storedName(seeded.workflowId)

      const renamed = edit(
        edit(source.files, `'${name}'`, "'Renamed in source'"),
        '{ variables:',
        "{ description: 'Scores leads', variables:"
      )
      const dryRun = await apply(source, renamed, { dryRun: true })
      expect(dryRun.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      expect(await storedName(seeded.workflowId)).toBe(name)
      const result = await apply(source, renamed)

      expect(result.workflowName).toBe('Renamed in source')
      const [row] = await db
        .select({ name: workflow.name, description: workflow.description })
        .from(workflow)
        .where(eq(workflow.id, seeded.workflowId))
      expect(row).toEqual({ name: 'Renamed in source', description: 'Scores leads' })
      const reread = await getSource(seeded.workflowId)
      expect(reread.base.fingerprint).toBe(result.base.fingerprint)
      expect(reread.files['workflow.ts']).toContain(
        "'Renamed in source',\n  { description: 'Scores leads',"
      )
      const again = await apply(reread, reread.files)
      expect(again.applied).toBe(false)
      expect(again.wroteSourceMeta).toBe(false)
    }
  )

  check(
    'a workflow renamed in source to a name its folder holds is refused at the name',
    async () => {
      const seeded = await seedWorkflow()
      const other = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const name = await storedName(seeded.workflowId)
      const taken = await storedName(other.workflowId)
      const before = await snapshot(seeded.workflowId)

      const files = edit(source.files, `'${name}'`, `'${taken}'`)
      const error = await expectRejected(apply(source, files), 'E_NAME_TAKEN')
      expect(error.diagnostics.find((d) => d.code === 'E_NAME_TAKEN')).toMatchObject({
        file: 'workflow.ts',
        ...positionOf(files['workflow.ts'], `'${taken}'`),
      })
      expect(await storedName(seeded.workflowId)).toBe(name)
      expect(await snapshot(seeded.workflowId)).toEqual(before)
    }
  )

  check(
    'a name or description the workflow API refuses is refused at the header, on an update and a create',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const name = await storedName(seeded.workflowId)
      const before = await snapshot(seeded.workflowId)

      for (const refused of ['', '   ', 'n'.repeat(256)]) {
        const error = await expectRejected(
          apply(source, edit(source.files, `'${name}'`, `'${refused}'`)),
          'E_WORKFLOW_META_INVALID'
        )
        expect(error.diagnostics.find((d) => d.code === 'E_WORKFLOW_META_INVALID')).toMatchObject({
          file: 'workflow.ts',
          line: expect.any(Number),
          hint: expect.any(String),
        })
      }
      await expectRejected(
        apply(
          source,
          edit(source.files, '{ variables:', `{ description: '${'d'.repeat(50_001)}', variables:`)
        ),
        'E_WORKFLOW_META_INVALID'
      )
      const dryRun = await apply(source, edit(source.files, `'${name}'`, "''"), { dryRun: true })
      expect(dryRun.diagnostics.map((d) => d.code)).toContain('E_WORKFLOW_META_INVALID')
      expect(await snapshot(seeded.workflowId)).toEqual(before)

      const longest = 'n'.repeat(255)
      const renamed = await apply(
        source,
        edit(
          edit(source.files, `'${name}'`, `'${longest}'`),
          '{ variables:',
          `{ description: '${'d'.repeat(50_000)}', variables:`
        )
      )
      expect(renamed.workflowName).toBe(longest)

      const created = withPermissionGroupScope(() =>
        createWorkflowFromSource.execute({
          principal,
          input: {
            workspaceId,
            files: {
              'workflow.ts': `// @sim-sdk 1
import { trigger, workflow } from '@sim/workflow-sdk'

export default workflow('', {}, () => {
  trigger.start('Start', {})
})
`,
            },
          },
        })
      )
      await expectRejected(created, 'E_WORKFLOW_META_INVALID')
    }
  )

  /** A workspace apply's plan of `files`, to commit after a concurrent write lands. */
  async function planned(
    source: ReadWorkflowSourceResult,
    files: Record<string, string>,
    planner: Principal = principal,
    pendingResources: PendingResource[] = []
  ) {
    const plan = await withPermissionGroupScope(() =>
      workflowSourceUpdate.plan.execute({
        principal: planner,
        input: {
          workflowId: source.workflowId,
          files,
          lock: source.lock,
          base: source.base,
          allowDelete: false,
          pendingResources,
          loads: {},
        },
      })
    )
    if (plan.kind === 'refused') throw new Error('The plan was refused')
    return plan
  }

  /** Commits a plan as a workspace apply does. */
  function commit(plan: PlannedSource, committer: Principal = principal) {
    return withPermissionGroupScope(() =>
      workflowSourceUpdate.commit.execute({ principal: committer, input: { planned: plan } })
    )
  }

  check(
    'a plan made in one session is refused when another session of the same user commits it',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const files = edit(source.files, SCORE_CODE, 'return 44')
      const plan = await planned(source, files)
      const before = await snapshot(seeded.workflowId)

      expect(
        await bindingRefusal(
          commit(plan, createSessionPrincipal({ userId: ownerId, sessionId: generateId() }))
        )
      ).toBe('PLAN_PRINCIPAL_MISMATCH')
      expect(await snapshot(seeded.workflowId)).toEqual(before)

      expect((await commit(plan)).applied).toBe(true)
    }
  )

  /** The binding code a commit refused with; fails the check on any other outcome. */
  async function bindingRefusal(committed: Promise<unknown>): Promise<string> {
    const error = await committed.then(
      () => null,
      (rejection: unknown) => rejection
    )
    expect(error).toBeInstanceOf(PlanBindingError)
    return (error as PlanBindingError).code
  }

  /**
   * `source` with an Insert Row block writing the table keyed `key`, and the stand-in an enclosing
   * workspace apply hands its plan for that table before creating it.
   */
  function writingStandInTable(source: ReadWorkflowSourceResult, key: string) {
    const withImport = Object.fromEntries(
      Object.entries(source.files).map(([path, text]) => [
        path,
        text.replace(
          /import \{ ([^}]*) \} from '@sim\/workflow-sdk'/,
          (_, names: string) =>
            `import { ${[...names.split(', '), 'table'].sort(compareStrings).join(', ')} } from '@sim/workflow-sdk'`
        ),
      ])
    )
    const files = edit(
      withImport,
      '  start.to(score)',
      `  const save = table.insertRow('Save Order', { tableId: table('${key}'), data: { email: 'a@example.com' } })\n  start.to(score)\n  score.to(save)`
    )
    const standIn: PendingResource = {
      kind: 'table',
      key,
      id: generateId(),
      placeholder: true,
      name: key,
      columns: ['email'],
    }
    return { files, standIn }
  }

  /** Creates the table keyed `key`, as the enclosing apply does before the workflows. */
  async function createKeyedTable(key: string) {
    const created = await createTableUseCase.execute({
      principal,
      input: {
        workspaceId,
        name: key,
        schema: { columns: [{ name: 'email', type: 'string' }] },
      },
    })
    await claimResourceKey({
      workspaceId,
      kind: 'table',
      key,
      resourceId: created.table.id,
      origin: 'adopted',
      createdBy: ownerId,
    })
  }

  check(
    'a plan that resolved a stand-in id is refused, before it is planned again, when another session commits it',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const { files, standIn } = writingStandInTable(source, 'orders')
      const plan = await planned(source, files, principal, [standIn])
      expect(plan.replan).toBeDefined()
      await createKeyedTable('orders')
      const before = await snapshot(seeded.workflowId)

      expect(
        await bindingRefusal(
          commit(plan, createSessionPrincipal({ userId: ownerId, sessionId: generateId() }))
        )
      ).toBe('PLAN_PRINCIPAL_MISMATCH')
      expect(await snapshot(seeded.workflowId)).toEqual(before)

      expect((await commit(plan)).applied).toBe(true)
    }
  )

  check(
    'a plan whose stand-in resource was never created is refused at commit, not written with the stand-in id',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const { files, standIn } = writingStandInTable(source, 'invoices')
      const plan = await planned(source, files, principal, [standIn])
      const before = await snapshot(seeded.workflowId)

      await expect(commit(plan)).rejects.toBeInstanceOf(WorkflowSourceRejectedError)
      expect(await snapshot(seeded.workflowId)).toEqual(before)
    }
  )

  check('a dry-run create under a name its folder already holds is refused at plan', async () => {
    const seeded = await seedWorkflow()
    const taken = await storedName(seeded.workflowId)

    const created = withPermissionGroupScope(() =>
      createWorkflowFromSource.execute({
        principal,
        input: {
          workspaceId,
          name: taken,
          dryRun: true,
          files: {
            'workflow.ts': `// @sim-sdk 1
import { trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Fresh', {}, () => {
  trigger.start('Start', {})
})
`,
          },
        },
      })
    )

    await expect(created).rejects.toMatchObject({ name: 'WorkflowSourceNameTakenError' })
  })

  check(
    'a source rename committed after a teammate renamed the workflow is a 409 and keeps their name',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const files = edit(source.files, `'${await storedName(seeded.workflowId)}'`, "'From source'")
      const plan = await planned(source, files)
      const teammate = `Teammate ${generateId()}`
      await updateWorkflow.execute({
        principal,
        input: { workflowId: seeded.workflowId, name: teammate },
      })

      await expect(commit(plan)).rejects.toMatchObject({
        name: 'WorkflowSourceStaleError',
        code: 'conflict',
      })
      expect(await storedName(seeded.workflowId)).toBe(teammate)
    }
  )

  check(
    'a name taken after the plan refuses the whole apply, leaving the graph unwritten',
    async () => {
      const seeded = await seedWorkflow()
      const other = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const name = await storedName(seeded.workflowId)
      const contested = `Contested ${generateId()}`
      const files = edit(edit(source.files, `'${name}'`, `'${contested}'`), SCORE_CODE, 'return 43')
      const plan = await planned(source, files)
      const before = await snapshot(seeded.workflowId)
      await updateWorkflow.execute({
        principal,
        input: { workflowId: other.workflowId, name: contested },
      })

      await expect(commit(plan)).rejects.toMatchObject({
        name: 'WorkflowSourceNameTakenError',
        code: 'conflict',
      })
      expect(await snapshot(seeded.workflowId)).toEqual(before)
      expect(await storedName(seeded.workflowId)).toBe(name)
    }
  )

  check(
    'a rename racing another onto one name in one folder is a name-taken 409, not a fault',
    async () => {
      const seeded = await seedWorkflow()
      const other = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const name = await storedName(seeded.workflowId)
      const contested = `Contested ${generateId()}`
      const files = edit(source.files, `'${name}'`, `'${contested}'`)
      let outcome: Promise<unknown> = Promise.resolve()
      let settled = false

      await db.transaction(async (tx) => {
        const [self] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        await tx.update(workflow).set({ name: contested }).where(eq(workflow.id, other.workflowId))
        outcome = runOutsideTransactionContext(() =>
          apply(source, files).finally(() => {
            settled = true
          })
        )
        await waitForBlocked(Number(self?.pid), () => settled)
      })

      await expect(outcome).rejects.toMatchObject({
        name: 'WorkflowSourceNameTakenError',
        code: 'conflict',
      })
      expect(await storedName(seeded.workflowId)).toBe(name)
      expect(await storedName(other.workflowId)).toBe(contested)
    }
  )

  check(
    'removing blocks refuses the apply without allowDelete, naming them, and applies with it',
    async () => {
      const start = seedBlock('start_trigger', 'Start')
      const score = seedBlock('function', 'Score', { code: ['code', 'return 1'] })
      const workflowId = await seedGraph([start, score])
      const source = await getInlineSource(workflowId)
      const before = await snapshot(workflowId)
      const entry = source.files['workflow.ts']
      const emptied = {
        ...source.files,
        'workflow.ts': entry.replace(/\(\) => \{[\s\S]*\}\)\s*$/, '() => {})\n'),
      }

      const error = await expectRejected(apply(source, emptied), 'E_APPLY_BLOCK_DELETE')
      expect(error.diagnostics.find((d) => d.code === 'E_APPLY_BLOCK_DELETE')).toMatchObject({
        message: 'This apply deletes 2 blocks the source no longer declares: Score, Start.',
        file: 'workflow.ts',
        ...positionOf(emptied['workflow.ts'], "'Source apply edge"),
      })
      expect(await snapshot(workflowId)).toEqual(before)

      const dryRun = await apply(source, emptied, { dryRun: true })
      expect(dryRun.diagnostics.map((d) => d.code)).toContain('E_APPLY_BLOCK_DELETE')

      const result = await apply(source, emptied, { allowDelete: true })
      expect(result.applied).toBe(true)
      expect(result.diff.blocks.removed.map((block) => block.key).sort()).toEqual([
        'score',
        'start',
      ])
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

  check(
    'a lock copied from another workflow is ignored where it claims ids, keeping the stored ones',
    async () => {
      const target = await seedWorkflow()
      const other = await seedWorkflow()
      const source = await getSource(target.workflowId)
      const foreign = await getSource(other.workflowId)

      // Block ids only: the foreign lock's variable ids are another matter.
      const result = await apply(source, edit(source.files, '41 + 1', '41 + 2'), {
        lock: { ...foreign.lock, variables: source.lock.variables },
      })

      expect(result.applied).toBe(true)
      const claims = result.diagnostics.filter((d) => d.code === 'W_MAT_LOCK_ID_CLAIMED')
      expect(claims.length).toBeGreaterThan(0)
      for (const claim of claims) {
        expect(claim.message).toContain('the block keeps the id of the stored block it matches')
      }
      expect(result.mintedIds).toEqual({})
      const after = await snapshot(target.workflowId)
      expect(Object.keys(after.state?.blocks ?? {}).sort()).toEqual(
        [target.startId, target.scoreId].sort()
      )
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
      expect.objectContaining({
        code: 'W_MAT_LOCK_ID_CLAIMED',
        blockKey: 'extra',
        message: expect.stringContaining('a new id was minted'),
      })
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
            .set({ updatedAt: new Date(), name: 'Scorer' })
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
        .set({
          updatedAt: new Date(),
          subBlocks: { ...subBlocks, model: { ...subBlocks.model, value: 'gpt-4.1' } },
        })
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
      expect.objectContaining({
        code: 'E_APPLY_STALE',
        severity: 'error',
        message: `Workflow "Source apply ${seeded.workflowId}" changed since this source was read. Get the source again, reapply your edit and retry.`,
      })
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
    'a plan is the dry run as a read: a reader gets it, it reports staleness, and it writes nothing',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const before = await snapshot(seeded.workflowId)
      const files = edit(source.files, SCORE_CODE, 'return 71')
      const plan = (base = source.base) =>
        withPermissionGroupScope(() =>
          planWorkflowSource.execute({
            principal: reader,
            input: { workflowId: seeded.workflowId, files, lock: source.lock, base },
          })
        )

      const planned = await plan()
      const dryRun = await apply(source, files, { dryRun: true })

      expect(planned).toMatchObject({ dryRun: true, applied: false })
      expect(planned.diff).toEqual(dryRun.diff)
      expect(planned.diagnostics).toEqual(dryRun.diagnostics)
      expect(planned.diff.blocks.modified.map((block) => block.id)).toEqual([seeded.scoreId])
      const stale = await plan({ ...source.base, fingerprint: `sf1:${'0'.repeat(64)}` })
      expect(stale.diagnostics.map((d) => d.code)).toContain('E_APPLY_STALE')
      expect(await snapshot(seeded.workflowId)).toEqual(before)
    }
  )

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
    'a dry run reports whether the draft it would write differs from the deployment',
    async () => {
      const start = seedBlock('start_trigger', 'Start')
      const writer = seedBlock('agent', 'Writer', {
        model: ['combobox', 'gpt-4o'],
        messages: ['messages-input', [{ role: 'user', content: 'hi' }]],
      })
      const score = seedBlock('function', 'Score', { code: ['code', 'return 1'] })
      const workflowId = await seedGraph([start, writer, score])
      const deployed = await loadWorkflowDeploymentSnapshot(workflowId)
      if (!deployed) throw new Error('The seeded draft has no deployment snapshot')
      await db.insert(workflowDeploymentVersion).values({
        id: generateId(),
        workflowId,
        version: 1,
        state: deployed,
        isActive: true,
      })
      await db.update(workflow).set({ isDeployed: true }).where(eq(workflow.id, workflowId))
      const source = await getSource(workflowId)
      const changed = edit(source.files, 'return 1', 'return 2')

      draftDeploymentChecks.count = 0
      const unchangedDryRun = await apply(source, source.files, { dryRun: true })
      // Only a dry run that leaves the draft as it is checks the stored draft's deployment.
      expect(draftDeploymentChecks.count).toBe(1)
      const changedDryRun = await apply(source, changed, { dryRun: true })
      expect(draftDeploymentChecks.count).toBe(1)
      const applied = await apply(source, changed)

      expect(unchangedDryRun.needsRedeployment).toBe(false)
      expect(changedDryRun.needsRedeployment).toBe(true)
      expect(applied.needsRedeployment).toBe(true)

      const edited = await getSource(workflowId)
      const reverted = edit(edited.files, 'return 2', 'return 1')
      const revertDryRun = await apply(edited, reverted, { dryRun: true })
      const revert = await apply(edited, reverted)

      expect(revertDryRun.needsRedeployment).toBe(false)
      expect(revert.needsRedeployment).toBe(false)
    }
  )

  check(
    'a committed apply records one audit row carrying the client, git sha, repository and counts',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)

      const result = await apply(source, edit(source.files, SCORE_CODE, 'return 81'), {
        provenance: {
          client: 'cli',
          gitSha: '0123abcd',
          repo: 'https://github.com/acme/flows.git',
        },
      })

      const rows = await settledAuditRows(seeded.workflowId, 1)
      expect(rows).toHaveLength(1)
      expect(rows[0].metadata).toMatchObject({
        op: 'apply_source',
        client: 'cli',
        gitSha: '0123abcd',
        repo: 'https://github.com/acme/flows.git',
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

describe('renames in source', () => {
  /** Start → Boom → Tally → Report, each a function; Report's code reads Boom and Tally by $ref. */
  async function seedChain(
    reportCode = 'return <boom.result> + <tally.result>',
    tallyCode = 'return 2'
  ) {
    const workflowId = generateId()
    const now = new Date()
    await db.insert(workflow).values({
      id: workflowId,
      userId: ownerId,
      workspaceId,
      name: `Source renames ${workflowId}`,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    const fn = (name: string, code: string): BlockState => ({
      id: generateId(),
      type: 'function',
      name,
      position: { x: 0, y: 0 },
      subBlocks: { code: { id: 'code', type: 'code', value: code } },
      outputs: {},
      enabled: true,
    })
    const start: BlockState = { ...fn('Start', ''), type: 'start_trigger', subBlocks: {} }
    const boom = fn('Boom', 'return 1')
    const tally = fn('Tally', tallyCode)
    const report = fn('Report', reportCode)
    const chain = [start, boom, tally, report]
    const saved = await saveWorkflowToNormalizedTables(workflowId, {
      blocks: Object.fromEntries(chain.map((block) => [block.id, block])),
      edges: chain.slice(1).map((block, index) => ({
        id: generateId(),
        source: chain[index].id,
        target: block.id,
      })),
      loops: {},
      parallels: {},
    })
    if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
    return { workflowId, ids: { boom: boom.id, tally: tally.id, report: report.id } }
  }

  const codes = (diagnostics: ReadonlyArray<{ code: string }>) => diagnostics.map((d) => d.code)

  /** Replaces every whole-word `from` in `workflow.ts`. */
  function renameIdent(files: Record<string, string>, from: string, to: string) {
    return {
      ...files,
      'workflow.ts': files['workflow.ts'].replace(new RegExp(`\\b${from}\\b(?!\\.js)`, 'g'), to),
    }
  }

  /** Start → Calc (a function whose result nothing types) → Reply, whose JSON data reads Calc. */
  async function seedUntypedReply() {
    const seeded = await seedChain()
    const source = await getSource(seeded.workflowId)
    const written = await apply(
      source,
      {
        'workflow.ts': [
          '// @sim-sdk 1',
          "import { codeFile, fn, response, trigger, workflow } from '@sim/workflow-sdk'",
          '',
          `export default workflow('Untyped reply ${seeded.workflowId}', {}, () => {`,
          "  const start = trigger.start('Start', {})",
          "  const calc = fn('Calc', { code: codeFile('./functions/calc.js') })",
          "  const reply = response('Reply', { dataMode: 'json', data: { total: calc.result.total } })",
          '  start.to(calc)',
          '  calc.to(reply)',
          '})',
          '',
        ].join('\n'),
        'functions/calc.js': 'return JSON.parse($ref.start.input)\n',
      },
      { allowDelete: true }
    )
    expect(written.applied).toBe(true)
    const calcId = written.lock.blocks.calc?.id
    return { workflowId: seeded.workflowId, calcId }
  }

  check(
    'an output typo in an existing block is one refusal at the reference, as an offline check reports it',
    async () => {
      const seeded = await seedChain()
      const source = await getSource(seeded.workflowId)
      const written = await apply(
        source,
        {
          'workflow.ts': [
            '// @sim-sdk 1',
            "import { api, response, trigger, workflow } from '@sim/workflow-sdk'",
            '',
            `export default workflow('Output typo ${seeded.workflowId}', {}, () => {`,
            "  const start = trigger.start('Start', {})",
            "  const fetch = api('Fetch', { url: 'https://example.com' })",
            "  const reply = response('Reply', { dataMode: 'json', data: { items: fetch.data } })",
            '  start.to(fetch)',
            '  fetch.to(reply)',
            '})',
            '',
          ].join('\n'),
        },
        { allowDelete: true }
      )
      expect(written.applied).toBe(true)
      const stored = await getSource(seeded.workflowId)
      const typo = edit(stored.files, 'fetch.data', 'fetch.dataa')

      const replyLine =
        typo['workflow.ts'].split('\n').findIndex((line) => line.includes('fetch.dataa')) + 1
      const replyId = written.lock.blocks.reply?.id

      const dryRun = await apply(stored, typo, { dryRun: true })

      expect(
        dryRun.diagnostics
          .filter((d) => d.blockId === replyId || d.line === replyLine)
          .map((d) => ({ code: d.code, severity: d.severity, file: d.file, line: d.line }))
      ).toEqual([
        { code: 'E_APPLY_UNRESOLVED_REF', severity: 'error', file: 'workflow.ts', line: replyLine },
      ])
      await expectRejected(apply(stored, typo), 'E_APPLY_UNRESOLVED_REF')
    }
  )

  check(
    'a rename does not report W_JSON_REF_UNTYPED on a JSON field only its reference rewrite changed',
    async () => {
      const displayOnly = await seedUntypedReply()
      const source = await getSource(displayOnly.workflowId)
      expect(codes((await apply(source, source.files, { dryRun: true })).diagnostics)).toEqual([])

      const renamed = await apply(source, edit(source.files, "fn('Calc'", "fn('Order Calc'"), {
        dryRun: true,
      })
      expect(renamed.diff.blocks.renamed).toEqual([
        { id: displayOnly.calcId, from: 'calc', to: 'ordercalc' },
      ])
      expect(codes(renamed.diagnostics)).toEqual([])

      const both = await seedUntypedReply()
      const bothSource = await getSource(both.workflowId)
      const files = edit(renameIdent(bothSource.files, 'calc', 'total'), "fn('Calc'", "fn('Total'")
      const inferred = await apply(bothSource, files, { dryRun: true })
      expect(inferred.diff.blocks.renamed).toEqual([{ id: both.calcId, from: 'calc', to: 'total' }])
      expect(codes(inferred.diagnostics)).not.toContain('W_JSON_REF_UNTYPED')
    }
  )

  check('two display-name renames in one save keep both ids and resolve their $refs', async () => {
    const seeded = await seedChain()
    const source = await getSource(seeded.workflowId)
    const files = edit(edit(source.files, "fn('Boom'", "fn('Bang'"), "fn('Tally'", "fn('Total'")

    const dryRun = await apply(source, files, { dryRun: true })
    expect(codes(dryRun.diagnostics)).toEqual([])
    const result = await apply(source, files)

    expect(result.applied).toBe(true)
    expect(result.diff.blocks.removed).toEqual([])
    expect(result.diff.blocks.renamed).toEqual([
      { id: seeded.ids.boom, from: 'boom', to: 'bang' },
      { id: seeded.ids.tally, from: 'tally', to: 'total' },
    ])
    const after = await snapshot(seeded.workflowId)
    expect(after.state?.blocks[seeded.ids.report]?.subBlocks.code?.value).toBe(
      'return <bang.result> + <total.result>'
    )
    expect(result.files['functions/report.js']).toBe('return $ref.bang.result + $ref.total.result')
  })

  check('two blocks that swap display names are two renames that move no edge', async () => {
    const seeded = await seedChain()
    const source = await getSource(seeded.workflowId)
    const files = edit(
      edit(edit(source.files, "fn('Boom'", "fn('Swap'"), "fn('Tally'", "fn('Boom'"),
      "fn('Swap'",
      "fn('Tally'"
    )

    const result = await apply(source, files)

    expect(result.applied).toBe(true)
    expect(result.diff.blocks.added).toEqual([])
    expect(result.diff.blocks.removed).toEqual([])
    expect(result.diff.blocks.renamed).toEqual([
      { id: seeded.ids.boom, from: 'boom', to: 'tally' },
      { id: seeded.ids.tally, from: 'tally', to: 'boom' },
    ])
    expect(result.diff.edges).toEqual({ added: 0, removed: 0 })
  })

  check('a retype is reported as a removed and an added block with all their edges', async () => {
    const seeded = await seedChain()
    const source = await getSource(seeded.workflowId)
    const entry = source.files['workflow.ts']
      .replace(/import \{ /, 'import { api, ')
      .replace(
        / {2}const tally = fn\('Tally'.*\n/,
        "  const tally = api('Tally', { url: 'https://x.test' })\n"
      )
    expect(entry).toContain("api('Tally'")
    const files = { ...omit(source.files, ['functions/tally.js']), 'workflow.ts': entry }

    const result = await apply(source, files)

    expect(result.applied).toBe(true)
    expect(codes(result.diagnostics)).toContain('W_MAT_RETYPE_RECREATED')
    expect(result.diff.blocks.removed).toEqual([
      { id: seeded.ids.tally, key: 'tally', type: 'function' },
    ])
    expect(result.diff.blocks.added).toEqual([
      expect.objectContaining({ key: 'tally', type: 'api' }),
    ])
    expect(result.diff.edges).toEqual({ added: 2, removed: 2 })
  })

  check(
    'after a name collision, renaming one block and dropping the other key override keeps both ids',
    async () => {
      const workflowId = generateId()
      const now = new Date()
      await db.insert(workflow).values({
        id: workflowId,
        userId: ownerId,
        workspaceId,
        name: `Source collision ${workflowId}`,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
      })
      const block = (name: string, type: string, code?: string): BlockState => ({
        id: generateId(),
        type,
        name,
        position: { x: 0, y: 0 },
        subBlocks: code === undefined ? {} : { code: { id: 'code', type: 'code', value: code } },
        outputs: {},
        enabled: true,
      })
      const start = block('Start', 'start_trigger')
      const first = block('Fetch Data', 'function', 'return 1')
      const second = block('Fetch.Data', 'function', 'return 2')
      const saved = await saveWorkflowToNormalizedTables(workflowId, {
        blocks: { [start.id]: start, [first.id]: first, [second.id]: second },
        edges: [
          { id: generateId(), source: start.id, target: first.id },
          { id: generateId(), source: first.id, target: second.id },
        ],
        loops: {},
        parallels: {},
      })
      if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
      const source = await getSource(workflowId)
      const entry = source.files['workflow.ts']
      expect(entry).toContain("key: 'fetchdata~2'")
      const edited = entry
        .replace("fn('Fetch Data'", "fn('Get Data'")
        .replace(/,?\s*key: 'fetchdata~2',?/, '')
        .replace(/, \{\s*\}\)/, ')')

      const result = await apply(source, { ...source.files, 'workflow.ts': edited })

      expect(codes(result.diagnostics)).not.toContain('E_APPLY_BLOCK_DELETE')
      expect(result.applied).toBe(true)
      expect(result.diff.blocks.removed).toEqual([])
      expect(result.diff.blocks.added).toEqual([])
      expect(result.diff.blocks.renamed).toEqual([
        { id: first.id, from: 'fetchdata', to: 'getdata' },
        { id: second.id, from: 'fetchdata~2', to: 'fetchdata' },
      ])
    }
  )

  check(
    'a block whose name and const both change while its wiring changes keeps its id',
    async () => {
      const seeded = await seedChain()
      const source = await getSource(seeded.workflowId)
      const files = edit(
        edit(renameIdent(source.files, 'boom', 'bang'), "fn('Boom'", "fn('Bang'"),
        '  tally.to(report)',
        '  tally.to(report)\n  bang.to(report)'
      )

      const result = await apply(source, files)

      expect(result.applied).toBe(true)
      expect(result.diff.blocks.removed).toEqual([])
      expect(result.diff.blocks.renamed).toEqual([
        { id: seeded.ids.boom, from: 'boom', to: 'bang' },
      ])
      expect(codes(result.diagnostics)).toContain('W_MAT_INFERRED_RENAME')
    }
  )

  check('three blocks of one type renamed name and const in one save keep their ids', async () => {
    const seeded = await seedChain()
    const source = await getSource(seeded.workflowId)
    let files = source.files
    for (const [ident, name, newIdent, newName] of [
      ['boom', 'Boom', 'bang', 'Bang'],
      ['tally', 'Tally', 'total', 'Total'],
      ['report', 'Report', 'summary', 'Summary'],
    ]) {
      files = edit(renameIdent(files, ident, newIdent), `fn('${name}'`, `fn('${newName}'`)
    }

    const result = await apply(source, files)

    expect(result.applied).toBe(true)
    expect(result.diff.blocks.removed).toEqual([])
    expect(result.diff.blocks.renamed.map((r) => r.id).sort()).toEqual(
      [seeded.ids.boom, seeded.ids.tally, seeded.ids.report].sort()
    )
    expect(codes(result.diagnostics)).not.toContain('W_UNRESOLVED_REF')
    const after = await snapshot(seeded.workflowId)
    expect(after.state?.blocks[seeded.ids.report]?.subBlocks.code?.value).toBe(
      'return <bang.result> + <total.result>'
    )
  })

  check(
    'renames nothing ties to the stored blocks are refused with how to keep the ids',
    async () => {
      const seeded = await seedChain()
      const source = await getSource(seeded.workflowId)
      let files = source.files
      for (const [ident, name, newIdent, newName] of [
        ['boom', 'Boom', 'bang', 'Bang'],
        ['tally', 'Tally', 'total', 'Total'],
      ]) {
        files = edit(renameIdent(files, ident, newIdent), `fn('${name}'`, `fn('${newName}'`)
      }
      files = edit(edit(files, 'return 1', 'return 10'), 'return 2', 'return 20')
      files = edit(
        files,
        '  start.to(bang)\n  bang.to(total)\n  total.to(report)',
        '  start.to(report)\n  report.to(bang)\n  report.to(total)'
      )

      const dryRun = await apply(source, files, { dryRun: true })

      const refusal = dryRun.diagnostics.find((d) => d.code === 'E_APPLY_BLOCK_DELETE')
      expect(refusal?.message).toBe(
        'This apply deletes 2 blocks the source no longer declares: Boom, Tally. It adds Bang, Total of the same type: if those are the same blocks renamed, both their name and const changed, so nothing ties them to the stored blocks and they would get new ids.'
      )
      expect(refusal?.hint).toBe(
        'To rename a block and keep its id, keep its const name in this apply (change it in the next), or rename the references to it with it; to replace it with a new block, pass --allow-delete.'
      )

      const allowed = await apply(source, files, { dryRun: true, allowDelete: true })
      expect(allowed.diff.blocks.removed.map(({ key, type }) => `${key} ${type}`)).toEqual([
        'boom function',
        'tally function',
      ])
      expect(allowed.diff.blocks.added.map(({ key, type }) => `${key} ${type}`)).toEqual([
        'bang function',
        'total function',
      ])
      expect(
        allowed.diagnostics
          .filter((d) => d.code === 'W_APPLY_PROBABLE_RENAME')
          .map((d) => d.message)
      ).toEqual([
        'Boom (function) is deleted and Bang (function) added: probably a rename, but its name and const both changed, so it gets a new id and loses its run history and webhook URL.',
        'Tally (function) is deleted and Total (function) added: probably a rename, but its name and const both changed, so it gets a new id and loses its run history and webhook URL.',
      ])
    }
  )

  check(
    'an unrelated delete and add of one type is refused without --allow-delete, keeping no id',
    async () => {
      const seeded = await seedChain()
      const source = await getSource(seeded.workflowId)
      const files = omit<Record<string, string>, string>(
        {
          ...edit(
            edit(
              edit(
                source.files,
                "  const tally = fn('Tally', { language: null, code: codeFile('./functions/tally.js') })\n",
                "  const fresh = fn('Fresh', { code: js`return 'unrelated'` })\n"
              ),
              '  boom.to(tally)\n  tally.to(report)',
              '  boom.to(report)\n  start.to(fresh)'
            ),
            'import { codeFile, fn,',
            'import { codeFile, fn, js,'
          ),
          'functions/report.js': 'return $ref.boom.result',
        },
        ['functions/tally.js']
      )

      const dryRun = await apply(source, files, { dryRun: true })

      expect(codes(dryRun.diagnostics)).toContain('E_APPLY_BLOCK_DELETE')
      expect(codes(dryRun.diagnostics)).not.toContain('W_MAT_INFERRED_RENAME')
      const allowed = await apply(source, files, { allowDelete: true })
      expect(allowed.diff.blocks.removed.map((block) => block.id)).toEqual([seeded.ids.tally])
    }
  )

  check(
    'a rename of name and const that rewires, changes its code and renames its references keeps its id',
    async () => {
      const seeded = await seedChain()
      const source = await getSource(seeded.workflowId)
      const renamed = edit(renameIdent(source.files, 'tally', 'total'), "fn('Tally'", "fn('Total'")
      const files = {
        ...edit(renamed, '  boom.to(total)\n', '  start.to(total)\n'),
        'functions/tally.js': 'return 3',
        'functions/report.js': 'return $ref.boom.result + $ref.total.result',
      }

      const result = await apply(source, files)

      expect(result.applied).toBe(true)
      expect(result.diff.blocks.removed).toEqual([])
      expect(result.diff.blocks.renamed).toEqual([
        { id: seeded.ids.tally, from: 'tally', to: 'total' },
      ])
      expect(result.diagnostics.find((d) => d.code === 'W_MAT_INFERRED_RENAME')?.message).toContain(
        'the references to it renamed with it'
      )
    }
  )

  check('a trigger renamed in name and const with changed settings is refused', async () => {
    const seeded = await seedChain()
    const source = await getSource(seeded.workflowId)
    const files = edit(
      edit(
        source.files,
        "const start = trigger.start('Start', {})",
        "const begin = trigger.start('Begin', { inputFormat: { question: 'string' } })"
      ),
      '  start.to(boom)',
      '  begin.to(boom)'
    )

    const dryRun = await apply(source, files, { dryRun: true })

    expect(codes(dryRun.diagnostics)).toContain('E_APPLY_BLOCK_DELETE')
    expect(codes(dryRun.diagnostics)).not.toContain('W_MAT_INFERRED_RENAME')
  })

  check(
    'a $ref to a missing block the edit wrote into a function file is refused, at the file',
    async () => {
      const seeded = await seedChain()
      const source = await getSource(seeded.workflowId)
      const files = { ...source.files, 'functions/boom.js': 'return $ref.nosuchblock.value\n' }

      const dryRun = await apply(source, files, { dryRun: true })

      expect(
        dryRun.diagnostics.map((d) => ({ code: d.code, severity: d.severity, file: d.file }))
      ).toEqual([{ code: 'E_APPLY_UNRESOLVED_REF', severity: 'error', file: 'functions/boom.js' }])
      await expectRejected(apply(source, files), 'E_APPLY_UNRESOLVED_REF')
    }
  )

  check('a $ref the edit wrote into a Python function file is refused', async () => {
    const seeded = await seedChain()
    const source = await getSource(seeded.workflowId)
    const entry = source.files['workflow.ts'].replace(
      /fn\('Boom', \{.*\}\)/,
      "fn('Boom', { language: 'python', code: codeFile('./functions/boom.py') })"
    )
    expect(entry).toContain('boom.py')
    const files = {
      ...omit(source.files, ['functions/boom.js']),
      'workflow.ts': entry,
      'functions/boom.py': 'return $ref.start.value\n',
    }

    const dryRun = await apply(source, files, { dryRun: true })

    expect(
      dryRun.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => ({ code: d.code, file: d.file }))
    ).toEqual([{ code: 'E_APPLY_CODE_FILE_REF_SYNTAX', file: 'functions/boom.py' }])
  })

  check(
    'refuses every edited Python file holding a $ref, however many the compile lists of that code',
    async () => {
      const seeded = await seedChain()
      const source = await getSource(seeded.workflowId)
      // More of one code than a compile lists, so the second file's are all left out of the listing.
      const refs = Array.from({ length: 120 }, (_, i) => `v${i} = $ref.start.v${i}`)
      const entry = source.files['workflow.ts']
        .replace(
          /fn\('Boom', \{.*\}\)/,
          "fn('Boom', { language: 'python', code: codeFile('./functions/boom.py') })"
        )
        .replace(
          /fn\('Tally', \{.*\}\)/,
          "fn('Tally', { language: 'python', code: codeFile('./functions/tally.py') })"
        )
      const files = {
        ...omit(source.files, ['functions/boom.js', 'functions/tally.js']),
        'workflow.ts': entry,
        'functions/boom.py': refs.join('\n'),
        'functions/tally.py': refs.join('\n'),
      }

      const dryRun = await apply(source, files, { dryRun: true })

      expect(
        [
          ...new Set(
            dryRun.diagnostics
              .filter((d) => d.code === 'E_APPLY_CODE_FILE_REF_SYNTAX')
              .map((d) => d.file)
          ),
        ].sort()
      ).toEqual(['functions/boom.py', 'functions/tally.py'])
    }
  )

  check(
    'refuses a missing block an edited file reads after a reference an inferred rename settles',
    async () => {
      // The stored Tally already reads more missing blocks than a compile lists of that code, so
      // each of Report's findings is left out of the listing.
      const ghosts = Array.from({ length: 20 }, (_, i) => `<ghost${i}.result>`)
      const seeded = await seedChain(undefined, `return [${ghosts.join(', ')}]`)
      const source = await getSource(seeded.workflowId)
      const files = {
        ...edit(renameIdent(source.files, 'boom', 'bang'), "fn('Boom'", "fn('Bang'"),
        'functions/report.js': 'return $ref.boom.result + $ref.nosuchblock.result\n',
      }

      const dryRun = await apply(source, files, { dryRun: true })

      expect(codes(dryRun.diagnostics)).toContain('W_MAT_INFERRED_RENAME')
      expect(
        dryRun.diagnostics
          .filter((d) => d.severity === 'error')
          .map((d) => ({ code: d.code, file: d.file }))
      ).toEqual([{ code: 'E_APPLY_UNRESOLVED_REF', file: 'functions/report.js' }])
    }
  )

  check(
    'a dangling reference the stored code already holds stays a warning, whatever else the apply changes',
    async () => {
      const seeded = await seedChain('return <ghost.result>')
      const source = await getSource(seeded.workflowId)
      expect(source.files['functions/report.js']).toBe('return $ref.ghost.result')

      const result = await apply(source, edit(source.files, "fn('Boom'", "fn('Bang'"))

      expect(result.applied).toBe(true)
      expect(
        result.diagnostics
          .filter((d) => d.code === 'W_UNRESOLVED_REF')
          .map((d) => ({ severity: d.severity, file: d.file }))
      ).toEqual([{ severity: 'warning', file: 'functions/report.js' }])
    }
  )
})

describe('iteration references outside their container', () => {
  const LOOP_SOURCE = `// @sim-sdk 1
import { fn, js, loop, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Each item', {}, () => {
  const start = trigger.start('Start', { inputFormat: { items: 'array' } })
  const each = loop.forEach('Each Item', { collection: start.items }, (item) => {
    const echo = fn('Echo', { code: js\`return \${item.index}\` })
    item.to(echo)
  })
  const after = fn('After', { code: 'return 1' })
  start.to(each)
  each.to(after)
})
`

  function create(source: string) {
    return withPermissionGroupScope(() =>
      createWorkflowFromSource.execute({
        principal,
        input: {
          workspaceId,
          name: `Source scope ${generateId()}`,
          files: { 'workflow.ts': source },
        },
      })
    )
  }

  check('a new block reading a loop index from after the loop is refused', async () => {
    const source = LOOP_SOURCE.replace(
      "fn('After', { code: 'return 1' })",
      `fn('After', { code: js\`return \${each.index}\` })`
    )
    await expectRejected(create(source), 'E_APPLY_REF_OUT_OF_SCOPE')
  })

  check('moving a block that reads <loop.index> out of its loop is refused', async () => {
    const created = await create(LOOP_SOURCE)
    expect(created.applied).toBe(true)
    const moved = LOOP_SOURCE.replace(
      `    const echo = fn('Echo', { code: js\`return \${item.index}\` })\n    item.to(echo)\n`,
      ''
    ).replace(
      '  start.to(each)\n',
      "  const echo = fn('Echo', { code: 'return <loop.index>' })\n  after.to(echo)\n  start.to(each)\n"
    )
    expect(moved).not.toContain('item.to(echo)')

    const dryRun = await apply(created, { 'workflow.ts': moved }, { dryRun: true })

    expect(
      dryRun.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => ({ code: d.code, blockKey: d.blockKey }))
    ).toEqual([{ code: 'E_APPLY_REF_OUT_OF_SCOPE', blockKey: 'echo' }])
  })

  check(
    'a stored block that already reads <loop.index> outside a loop stays a warning',
    async () => {
      const workflowId = generateId()
      const now = new Date()
      await db.insert(workflow).values({
        id: workflowId,
        userId: ownerId,
        workspaceId,
        name: `Source scope ${workflowId}`,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
      })
      const block = (name: string, type: string, code?: string): BlockState => ({
        id: generateId(),
        type,
        name,
        position: { x: 0, y: 0 },
        subBlocks: code === undefined ? {} : { code: { id: 'code', type: 'code', value: code } },
        outputs: {},
        enabled: true,
      })
      const start = block('Start', 'start_trigger')
      const stray = block('Stray', 'function', 'return <loop.index>')
      const tail = block('Tail', 'function', 'return 1')
      const saved = await saveWorkflowToNormalizedTables(workflowId, {
        blocks: { [start.id]: start, [stray.id]: stray, [tail.id]: tail },
        edges: [
          { id: generateId(), source: start.id, target: stray.id },
          { id: generateId(), source: stray.id, target: tail.id },
        ],
        loops: {},
        parallels: {},
      })
      if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
      const source = await getSource(workflowId)

      const result = await apply(source, edit(source.files, "fn('Tail'", "fn('Last'"))

      expect(result.applied).toBe(true)
      expect(
        result.diagnostics
          .filter((d) => d.code.includes('OUT_OF_SCOPE') || d.code.endsWith('_LINT'))
          .map((d) => ({ code: d.code, severity: d.severity, blockKey: d.blockKey }))
      ).toEqual([{ code: 'W_REF_OUT_OF_SCOPE', severity: 'warning', blockKey: 'stray' }])
    }
  )
})

describe('workflow variables in source', () => {
  /** `workflow.ts` with its `variables` option replaced by `variables` (source text). */
  function withVariables(files: Record<string, string>, variables: string): Record<string, string> {
    const entry = files['workflow.ts']
    const edited = entry.replace(/variables: \{[^}]*\{[^}]*\}[^}]*\}/, `variables: ${variables}`)
    expect(edited, 'the source declares its variables').not.toBe(entry)
    return { ...files, 'workflow.ts': edited }
  }

  check('a variable renamed to a key of the same type keeps its id', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)

    const result = await apply(
      source,
      withVariables(source.files, "{ limit: { type: 'number', value: 3 } }")
    )

    expect(result.applied).toBe(true)
    expect(result.diff.variables).toMatchObject({
      added: [],
      removed: [],
      renamed: [{ from: 'threshold', to: 'limit' }],
    })
    const [row] = await db
      .select({ variables: workflow.variables })
      .from(workflow)
      .where(eq(workflow.id, seeded.workflowId))
    expect(Object.keys(row.variables as Record<string, unknown>)).toEqual([seeded.variableId])
    const [audit] = await settledAuditRows(seeded.workflowId, 1)
    expect(audit?.metadata).toMatchObject({ variablesChanged: 1 })
  })

  check(
    'an unrelated variable of the same type replacing one is a delete, refused without allowDelete',
    async () => {
      const seeded = await seedWorkflow()
      const source = await getSource(seeded.workflowId)
      const files = withVariables(source.files, "{ retries: { type: 'number', value: 5 } }")

      const error = await expectRejected(apply(source, files), 'E_APPLY_VARIABLE_DELETE')
      expect(error.diagnostics.find((d) => d.code === 'E_APPLY_VARIABLE_DELETE')?.hint).toMatch(
        /If retries renames threshold, .* second apply, .* --allow-delete/
      )
      const allowed = await apply(source, files, { allowDelete: true, dryRun: true })
      expect(allowed.diff.variables).toMatchObject({
        added: ['retries'],
        removed: ['threshold'],
        renamed: [],
      })
    }
  )

  check(
    'two variables renamed in one apply are refused with a hint to rename them one apply at a time',
    async () => {
      const seeded = await seedWorkflow()
      const first = await getSource(seeded.workflowId)
      const added = await apply(
        first,
        withVariables(
          first.files,
          "{ threshold: { type: 'number', value: 3 }, limit: { type: 'string', value: 'x' } }"
        )
      )
      expect(added.applied).toBe(true)
      const source = await getSource(seeded.workflowId)
      const entry = source.files['workflow.ts']
      const renamed = entry.replace('threshold:', 'ceiling:').replace('limit:', 'cap:')
      expect(renamed, 'the source declares both variables').not.toBe(entry)

      const error = await expectRejected(
        apply(source, { ...source.files, 'workflow.ts': renamed }),
        'E_APPLY_VARIABLE_DELETE'
      )
      expect(error.diagnostics.find((d) => d.code === 'E_APPLY_VARIABLE_DELETE')?.hint).toMatch(
        /rename them one apply at a time/
      )
    }
  )

  check('deleting a variable is refused without allowDelete, like deleting a block', async () => {
    const seeded = await seedWorkflow()
    const source = await getSource(seeded.workflowId)
    const files = withVariables(source.files, '{}')
    const before = await snapshot(seeded.workflowId)

    const error = await expectRejected(apply(source, files), 'E_APPLY_VARIABLE_DELETE')

    expect(error.diagnostics.find((d) => d.code === 'E_APPLY_VARIABLE_DELETE')?.message).toContain(
      'threshold'
    )
    expect(await snapshot(seeded.workflowId)).toEqual(before)
    const allowed = await apply(source, files, { allowDelete: true })
    expect(allowed.applied).toBe(true)
    expect(allowed.diff.variables.removed).toEqual(['threshold'])
  })
})
