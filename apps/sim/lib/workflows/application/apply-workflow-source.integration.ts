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
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, sql } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import {
  type ApplyWorkflowSourceInput,
  applyWorkflowSource,
} from '@/lib/workflows/application/apply-workflow-source'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { WorkflowSourceRejectedError } from '@/lib/workflows/application/source-error'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

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
  source: ReadWorkflowSourceResult,
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
  expect(result.fingerprint).toBe(source.fingerprint)
  expect(await snapshot(seeded.workflowId)).toEqual(before)
  expect(await settledAuditRows(seeded.workflowId, 0)).toHaveLength(0)
  expect(notifiedFor(seeded.workflowId)).toBe(0)
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
  expect(reread.fingerprint).toBe(result.fingerprint)
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
    expect(again.fingerprint).toBe(result.fingerprint)
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
  expect(result.fingerprint).not.toBe(source.fingerprint)
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
