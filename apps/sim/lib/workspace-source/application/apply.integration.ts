/**
 * Real PostgreSQL coverage for workspace source (tables and workflows): `readWorkspaceSource`
 * prints a workspace as a directory, `applyWorkspaceSource` writes one back. Every check runs in
 * its own workspace and reads the stored rows directly, so "nothing was written" means the rows
 * are unchanged, not that the use case said so. Writes a report to
 * `WORKSPACE_SOURCE_APPLY_REPORT_PATH`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  auditLog,
  permissions,
  user,
  userTableDefinitions,
  userTableRows,
  workflow,
  workspace,
  workspaceResourceKey,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import * as tableUseCases from '@/lib/table/application/tables'
import { getTableById } from '@/lib/table/service'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import {
  type ApplyWorkspaceSourceInput,
  applyWorkspaceSource,
} from '@/lib/workspace-source/application/apply-workspace-source'
import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const ownerId = generateId()
const readerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const reader = createSessionPrincipal({ userId: readerId, sessionId: generateId() })
const workspaceIds: string[] = []
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

const LEADS = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'leads',
  columns: {
    email: column.string({ required: true }),
    status: column.select({ options: ['new', 'won'] }),
  },
})
`

const INGEST = `// @sim-sdk 1
import { table, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Ingest', {}, () => {
  const start = trigger.start('Start', { inputFormat: { email: 'string' } })
  const save = table.insertRow('Save Lead', {
    tableId: table('leads'),
    data: { email: start.email },
  })

  start.to(save)
})
`

/** The directory a check starts from: a table and a workflow that writes to it. */
const STARTER: Record<string, string> = {
  'tables/leads.ts': LEADS,
  'workflows/ingest/workflow.ts': INGEST,
}

async function newWorkspace(): Promise<string> {
  const workspaceId = generateId()
  workspaceIds.push(workspaceId)
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Workspace source',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values([
    {
      id: generateId(),
      userId: ownerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    },
    {
      id: generateId(),
      userId: readerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'read',
    },
  ])
  return workspaceId
}

type ApplyOptions = Partial<Omit<ApplyWorkspaceSourceInput, 'workspaceId' | 'files'>> & {
  principal?: Principal
}

function apply(workspaceId: string, files: Record<string, string>, options: ApplyOptions = {}) {
  const { principal = owner, ...input } = options
  return withPermissionGroupScope(() =>
    applyWorkspaceSource.execute({
      principal,
      input: { workspaceId, files, kinds: ['table', 'workflow'], ...input },
    })
  )
}

function get(workspaceId: string) {
  return withPermissionGroupScope(() =>
    readWorkspaceSource.execute({
      principal: owner,
      input: { workspaceId, kinds: ['table', 'workflow'] },
    })
  )
}

async function refusal(promise: Promise<unknown>): Promise<WorkspaceSourceRejectedError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(WorkspaceSourceRejectedError)
  return error as WorkspaceSourceRejectedError
}

function codes(diagnostics: ReadonlyArray<{ code: string; severity: string }>, severity = 'error') {
  return diagnostics
    .filter((finding) => finding.severity === severity)
    .map((finding) => finding.code)
}

async function tables(workspaceId: string) {
  return db
    .select()
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )
}

async function workflows(workspaceId: string) {
  return db
    .select({ id: workflow.id, name: workflow.name, updatedAt: workflow.updatedAt })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
}

/** The workspace's one stored table, as the table service reads it. */
async function storedTable(workspaceId: string) {
  const [row] = await tables(workspaceId)
  const table = row ? await getTableById(row.id) : null
  if (!table) throw new Error('The workspace has no table')
  return table
}

/** Every stored table's schema and update time: what "nothing was written" compares. */
async function tableSnapshot(workspaceId: string) {
  return (await tables(workspaceId)).map(({ id, name, schema, updatedAt }) => ({
    id,
    name,
    schema,
    updatedAt: updatedAt.getTime(),
  }))
}

/** Inserts one row into the workspace's stored table, by column name. */
async function insertRow(workspaceId: string, cells: Record<string, unknown>) {
  const table = await storedTable(workspaceId)
  const data = Object.fromEntries(
    Object.entries(cells).map(([name, value]) => [
      table.schema.columns.find((column) => column.name === name)?.id ?? name,
      value,
    ])
  )
  await db.insert(userTableRows).values({
    id: generateId(),
    tableId: table.id,
    workspaceId,
    data,
    position: 0,
  })
}

/** The id of a select option of the workspace's stored table. */
async function optionId(workspaceId: string, columnName: string, optionName: string) {
  const table = await storedTable(workspaceId)
  const column = table.schema.columns.find((candidate) => candidate.name === columnName)
  return column?.options?.find((option) => option.name === optionName)?.id ?? ''
}

async function setUp(workspaceId: string) {
  const created = await apply(workspaceId, STARTER)
  expect(created.failed).toBeUndefined()
  return get(workspaceId)
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values(
    [ownerId, readerId].map((id) => ({
      id,
      name: 'Workspace source fixture',
      email: `${id}@workspace-source.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
})

afterAll(async () => {
  const reportPath =
    process.env.WORKSPACE_SOURCE_APPLY_REPORT_PATH ??
    resolve('test-results/workspace-source-apply.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  if (workspaceIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.workspaceId, workspaceIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  }
  await db.delete(user).where(inArray(user.id, [ownerId, readerId]))
})

describe('workspace source apply', () => {
  check('creates a table and a workflow that writes to it in one apply', async () => {
    const workspaceId = await newWorkspace()

    const dryRun = await apply(workspaceId, STARTER, { dryRun: true })
    expect(codes(dryRun.diagnostics)).toEqual([])
    expect(dryRun.plan.map(({ kind, key, action }) => `${action} ${kind}:${key}`)).toEqual([
      'create table:leads',
      'create workflow:ingest',
    ])
    expect(await tables(workspaceId)).toEqual([])

    const result = await apply(workspaceId, STARTER)

    expect(result.failed).toBeUndefined()
    const [leads] = await tables(workspaceId)
    expect(leads?.name).toBe('leads')
    const [ingest] = await workflows(workspaceId)
    const state = await loadWorkflowFromNormalizedTables(ingest.id)
    const tableIds = Object.values(state?.blocks ?? {}).map(
      (block) => block.subBlocks?.tableSelector?.value
    )
    expect(tableIds).toContain(leads.id)
    expect(result.base.resources['table:leads']?.id).toBe(leads.id)
    expect(result.base.resources['workflow:ingest']?.id).toBe(ingest.id)
    expect(Object.keys(result.files).sort()).toEqual([
      'tables/leads.ts',
      'workflows/ingest/.sim/base.json',
      'workflows/ingest/.sim/lock.json',
      'workflows/ingest/workflow.ts',
    ])
  })

  check(
    're-applying a fresh get changes nothing, and a get reproduces the apply byte for byte',
    async () => {
      const workspaceId = await newWorkspace()
      const created = await apply(workspaceId, STARTER)
      const read = await get(workspaceId)
      expect(read.files).toEqual(created.files)
      expect(read.base).toEqual(created.base)
      const before = await tableSnapshot(workspaceId)
      const workflowsBefore = await workflows(workspaceId)

      const again = await apply(workspaceId, read.files, { base: read.base })

      expect(again.plan.every((change) => change.action === 'noop')).toBe(true)
      expect(again.applied).toEqual([])
      expect(await tableSnapshot(workspaceId)).toEqual(before)
      expect(await workflows(workspaceId)).toEqual(workflowsBefore)
    }
  )

  check(
    'refuses to drop a column holding data without --allow-delete, and drops it with it',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const leads = await storedTable(workspaceId)
      const statusId = leads.schema.columns.find((column) => column.name === 'status')?.id ?? ''
      await db.insert(userTableRows).values({
        id: generateId(),
        tableId: leads.id,
        workspaceId,
        data: { [leads.schema.columns[0].id ?? '']: 'a@b.c', [statusId]: 'x' },
        position: 0,
      })
      const files = {
        ...read.files,
        'tables/leads.ts': read.files['tables/leads.ts'].replace(/\n {4}status: .*\n/, '\n'),
      }
      const before = await tableSnapshot(workspaceId)

      const refused = await refusal(apply(workspaceId, files, { base: read.base }))

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect(refused.diagnostics[0].message).toContain('1 cell(s)')
      expect(await tableSnapshot(workspaceId)).toEqual(before)

      const dropped = await apply(workspaceId, files, { base: read.base, allowDelete: true })

      expect(dropped.failed).toBeUndefined()
      const after = await storedTable(workspaceId)
      expect(after.schema.columns.map((column) => column.name)).toEqual(['email'])
    }
  )

  check(
    'refuses an edit to a table changed on the server, and only notes a change it leaves alone',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const [leads] = await tables(workspaceId)
      await tableUseCases.updateTableUseCase.execute({
        principal: owner,
        input: { tableId: leads.id, workspaceId, description: 'Edited in the UI' },
      })
      const before = await tableSnapshot(workspaceId)
      const edited = {
        ...read.files,
        'tables/leads.ts': read.files['tables/leads.ts'].replace(
          "name: 'leads',",
          "name: 'leads2',"
        ),
      }

      const stale = await refusal(apply(workspaceId, edited, { base: read.base }))

      expect(stale.code).toBe('conflict')
      expect(stale.stale).toBe(true)
      expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect(await tableSnapshot(workspaceId)).toEqual(before)

      const untouched = await apply(workspaceId, read.files, { base: read.base })
      expect(untouched.applied).toEqual([])
      expect(codes(untouched.diagnostics, 'info')).toContain('I_SERVER_CHANGED')
      expect(await tableSnapshot(workspaceId)).toEqual(before)
    }
  )

  check('refuses a change to a schema-locked table before writing anything', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const [leads] = await tables(workspaceId)
    await db
      .update(userTableDefinitions)
      .set({ schemaLocked: true })
      .where(eq(userTableDefinitions.id, leads.id))
    const files = {
      ...read.files,
      'tables/leads.ts': read.files['tables/leads.ts'].replace(
        'columns: {',
        'columns: {\n    score: column.number(),'
      ),
      'tables/accounts.ts': LEADS.replace("name: 'leads'", "name: 'accounts'"),
    }

    const locked = await refusal(apply(workspaceId, files, { base: read.base }))

    expect(locked.code).toBe('locked')
    expect(codes(locked.diagnostics)).toEqual(['E_APPLY_LOCKED'])
    expect((await tables(workspaceId)).map((table) => table.name)).toEqual(['leads'])
  })

  check(
    'a write that fails mid-apply keeps what was written, stops, and a re-run converges',
    async () => {
      const workspaceId = await newWorkspace()
      const files = {
        ...STARTER,
        'tables/accounts.ts': LEADS.replace("name: 'leads'", "name: 'accounts'"),
      }
      const createTable = tableUseCases.createTableUseCase.execute
      const failing = vi
        .spyOn(tableUseCases.createTableUseCase, 'execute')
        .mockImplementation(async (args) => {
          if (args.input.name === 'accounts') throw new Error('connection reset')
          return createTable(args)
        })

      const partial = await apply(workspaceId, files).finally(() => failing.mockRestore())

      expect(partial.applied.map(({ kind, key }) => `${kind}:${key}`)).toEqual(['table:leads'])
      expect(partial.failed).toMatchObject({
        kind: 'table',
        key: 'accounts',
        code: 'E_APPLY_FAILED',
      })
      expect(Object.keys(partial.base.resources)).toEqual(['table:leads'])
      expect(await workflows(workspaceId)).toEqual([])

      const rerun = await apply(workspaceId, files, { base: partial.base })

      expect(rerun.failed).toBeUndefined()
      expect(rerun.plan.map(({ kind, key, action }) => `${action} ${kind}:${key}`)).toEqual([
        'noop table:leads',
        'create table:accounts',
        'create workflow:ingest',
      ])
      expect((await tables(workspaceId)).map((table) => table.name).sort()).toEqual([
        'accounts',
        'leads',
      ])
    }
  )

  check(
    'a workspace API key is refused workflows at plan time and may apply tables alone',
    async () => {
      const workspaceId = await newWorkspace()
      const key = createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() })

      const refused = await refusal(apply(workspaceId, STARTER, { principal: key }))

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_FORBIDDEN'])
      expect(refused.diagnostics.find((finding) => finding.severity === 'error')).toMatchObject({
        kind: 'workflow',
        key: 'ingest',
      })
      expect(await tables(workspaceId)).toEqual([])

      const tablesOnly = await apply(workspaceId, STARTER, { principal: key, only: ['table'] })

      expect(tablesOnly.applied.map(({ kind, key: resource }) => `${kind}:${resource}`)).toEqual([
        'table:leads',
      ])
    }
  )

  check('refuses a read-only member before planning anything', async () => {
    const workspaceId = await newWorkspace()

    const error = await apply(workspaceId, STARTER, { principal: reader }).then(
      () => null,
      (caught: unknown) => caught
    )

    expect(error).toMatchObject({ code: 'forbidden' })
    expect(await tables(workspaceId)).toEqual([])
  })

  check(
    're-claims a deleted table’s key, adopts an unbound table by name, and refuses a taken name',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const [first] = await tables(workspaceId)
      await tableUseCases.deleteTableUseCase.execute({
        principal: owner,
        input: { tableId: first.id, workspaceId },
      })

      const recreated = await apply(workspaceId, read.files, { base: read.base, only: ['table'] })

      expect(recreated.applied.map(({ action, key }) => `${action} ${key}`)).toContain(
        'create leads'
      )
      const [second] = await tables(workspaceId)
      expect(second.id).not.toBe(first.id)
      const [binding] = await db
        .select({ resourceId: workspaceResourceKey.resourceId })
        .from(workspaceResourceKey)
        .where(
          and(
            eq(workspaceResourceKey.workspaceId, workspaceId),
            eq(workspaceResourceKey.kind, 'table'),
            eq(workspaceResourceKey.key, 'leads')
          )
        )
      expect(binding?.resourceId).toBe(second.id)

      const { table: unbound } = await tableUseCases.createTableUseCase.execute({
        principal: owner,
        input: {
          workspaceId,
          name: 'contacts',
          schema: { columns: [{ name: 'email', type: 'string' }] },
        },
      })
      const adopted = await apply(
        workspaceId,
        { 'tables/people.ts': LEADS.replace("name: 'leads'", "name: 'contacts'") },
        { kinds: ['table'], only: ['table'] }
      )
      expect(adopted.applied).toMatchObject([{ action: 'adopt', key: 'people', id: unbound.id }])

      const taken = await refusal(
        apply(workspaceId, { 'tables/other.ts': LEADS }, { kinds: ['table'], only: ['table'] })
      )
      expect(codes(taken.diagnostics)).toContain('E_NAME_TAKEN')
    }
  )

  check('refuses deleting a table a declared workflow still uses', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const files = Object.fromEntries(
      Object.entries(read.files).filter(([path]) => path !== 'tables/leads.ts')
    )

    const refused = await refusal(apply(workspaceId, files, { base: read.base, allowDelete: true }))

    expect(codes(refused.diagnostics)).toEqual(['E_PLAN_REF_DELETED'])
    expect(await tables(workspaceId)).toHaveLength(1)
  })

  check(
    'refuses removing a select option its cells use without --allow-delete, and counts them',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const won = await optionId(workspaceId, 'status', 'won')
      await insertRow(workspaceId, { email: 'a@b.c', status: won })
      const files = {
        ...read.files,
        'tables/leads.ts': read.files['tables/leads.ts'].replace("'won'", "'closed'"),
      }
      const before = await tableSnapshot(workspaceId)

      const dryRun = await apply(workspaceId, files, { base: read.base, dryRun: true })
      expect(dryRun.plan.find((change) => change.key === 'leads')?.destructive).toEqual({
        what: 'cells',
        counts: { columns: 0, options: 1, cells: 1 },
      })
      const refused = await refusal(apply(workspaceId, files, { base: read.base }))

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect(refused.diagnostics[0].message).toContain('removes 1 select option(s)')
      expect(await tableSnapshot(workspaceId)).toEqual(before)

      const applied = await apply(workspaceId, files, { base: read.base, allowDelete: true })

      expect(applied.failed).toBeUndefined()
      expect(await optionId(workspaceId, 'status', 'closed')).not.toBe('')
    }
  )
})
