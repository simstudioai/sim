import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  user,
  userTableDefinitions,
  userTableRows,
  workflow,
  workspaceResourceKey,
} from '@sim/db/schema'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import * as columnUseCases from '@/lib/table/application/columns'
import * as tableUseCases from '@/lib/table/application/tables'
import { getColumnRetypeScanBatchSize } from '@/lib/table/columns/service'
import { getTableById } from '@/lib/table/service'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import type { ApplyWorkspaceSourceInput } from '@/lib/workspace-source/application/apply-workspace-source'
import {
  codes,
  refusal,
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const ownerId = generateId()
const readerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const reader = createSessionPrincipal({ userId: readerId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_APPLY_REPORT_PATH',
  'workspace-source-apply.json'
)
const workspaces = sourceWorkspaces()

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
  return workspaces.create({
    name: 'Workspace source',
    ownerId,
    members: [{ userId: readerId, permission: 'read' }],
  })
}

type ApplyOptions = Partial<Omit<ApplyWorkspaceSourceInput, 'workspaceId' | 'files'>> & {
  principal?: Principal
}

const runner = sourceRunner(['table', 'workflow'], owner)

function apply(workspaceId: string, files: Record<string, string>, options: ApplyOptions = {}) {
  return runner.apply(workspaceId, { files, ...options })
}

function get(workspaceId: string) {
  return runner.get(workspaceId)
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
  await writeReport()
  await workspaces.cleanup()
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
    'keeps a deleted table deleted, re-claims its key without a base entry, adopts an unbound table by name, and refuses a taken name',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const [first] = await tables(workspaceId)
      await tableUseCases.deleteTableUseCase.execute({
        principal: owner,
        input: { tableId: first.id, workspaceId },
      })

      const untouched = await apply(workspaceId, read.files, { base: read.base, only: ['table'] })
      expect(untouched.applied).toEqual([])
      expect(codes(untouched.diagnostics, 'info')).toContain('I_SERVER_DELETED')
      expect(await tables(workspaceId)).toEqual([])

      const { 'table:leads': _deleted, ...resources } = read.base.resources
      const recreated = await apply(workspaceId, read.files, {
        base: { ...read.base, resources },
        only: ['table'],
      })

      expect(recreated.applied.map(({ action, key }) => `${action} ${key}`)).toContain(
        'create leads'
      )
      expect(codes(recreated.diagnostics, 'info')).toContain('I_KEY_REBOUND')
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

  check(
    'a renamed workflow folder updates its workflow and plans no delete, even with --allow-delete',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const [ingest] = await workflows(workspaceId)
      const files = Object.fromEntries(
        Object.entries(read.files).map(([path, text]) => [
          path.replace('workflows/ingest/', 'workflows/intake/'),
          path === 'workflows/ingest/workflow.ts'
            ? text.replace("'Save Lead'", "'Store Lead'")
            : text,
        ])
      )

      const result = await apply(workspaceId, files, { base: read.base, allowDelete: true })

      expect(result.failed).toBeUndefined()
      expect(
        result.plan
          .filter((change) => change.action !== 'noop')
          .map(({ kind, key, action }) => `${action} ${kind}:${key}`)
      ).toEqual(['update workflow:intake'])
      expect((await workflows(workspaceId)).map((stored) => stored.id)).toEqual([ingest.id])
      expect(result.base.resources['workflow:intake']?.id).toBe(ingest.id)
    }
  )

  check('refuses deleting a table changed on the server since the directory was read', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const [leads] = await tables(workspaceId)
    await tableUseCases.updateTableUseCase.execute({
      principal: owner,
      input: { tableId: leads.id, workspaceId, description: 'Edited in the UI' },
    })
    const files = Object.fromEntries(
      Object.entries(read.files).filter(([path]) => path.startsWith('workflows/'))
    )

    const stale = await refusal(
      apply(workspaceId, files, { base: read.base, allowDelete: true, only: ['table'] })
    )

    expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
    expect(await tables(workspaceId)).toHaveLength(1)
  })

  check('a table delete re-checks the table before writing, and stops if it moved', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const [leads] = await tables(workspaceId)
    const authorize = tableUseCases.deleteTableUseCase.authorize
    const racing = vi
      .spyOn(tableUseCases.deleteTableUseCase, 'authorize')
      .mockImplementation(async (args) => {
        await tableUseCases.updateTableUseCase.execute({
          principal: owner,
          input: { tableId: leads.id, workspaceId, description: 'Edited while planning' },
        })
        return authorize(args)
      })
    const files = Object.fromEntries(
      Object.entries(read.files).filter(([path]) => path.startsWith('workflows/'))
    )

    const result = await apply(workspaceId, files, {
      base: read.base,
      allowDelete: true,
      only: ['table'],
    }).finally(() => racing.mockRestore())

    expect(result.failed).toMatchObject({ kind: 'table', key: 'leads', code: 'E_APPLY_STALE' })
    expect(await tables(workspaceId)).toHaveLength(1)
  })

  check(
    'a table update that fails after a column drop records what committed, and a re-run converges',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const files = {
        ...read.files,
        'tables/leads.ts': read.files['tables/leads.ts']
          .replace(/\n {4}status: .*\n/, '\n')
          .replace('columns: {', 'columns: {\n    score: column.number(),'),
      }
      const failing = vi
        .spyOn(columnUseCases.addTableColumnUseCase, 'execute')
        .mockRejectedValue(new Error('connection reset'))

      const partial = await apply(workspaceId, files, {
        base: read.base,
        allowDelete: true,
      }).finally(() => failing.mockRestore())

      expect(partial.failed).toMatchObject({ kind: 'table', key: 'leads', code: 'E_APPLY_FAILED' })
      expect((await storedTable(workspaceId)).schema.columns.map((column) => column.name)).toEqual([
        'email',
      ])

      const rerun = await apply(workspaceId, files, { base: partial.base, allowDelete: true })

      expect(rerun.failed).toBeUndefined()
      expect(rerun.plan.find((change) => change.key === 'leads')).toMatchObject({
        action: 'update',
        fields: ['columns.score (add)'],
      })
      expect((await storedTable(workspaceId)).schema.columns.map((column) => column.name)).toEqual([
        'email',
        'score',
      ])
    }
  )

  check(
    'an adopt whose changes fail leaves the table unbound, and a re-run adopts it',
    async () => {
      const workspaceId = await newWorkspace()
      await tableUseCases.createTableUseCase.execute({
        principal: owner,
        input: {
          workspaceId,
          name: 'leads',
          schema: { columns: [{ name: 'email', type: 'string', required: true }] },
        },
      })
      const files = { 'tables/leads.ts': LEADS }
      const failing = vi
        .spyOn(columnUseCases.addTableColumnUseCase, 'execute')
        .mockRejectedValue(new Error('connection reset'))

      const partial = await apply(workspaceId, files, {
        kinds: ['table'],
        only: ['table'],
      }).finally(() => failing.mockRestore())

      expect(partial.failed).toMatchObject({ kind: 'table', key: 'leads' })

      const rerun = await apply(workspaceId, files, {
        base: partial.base,
        kinds: ['table'],
        only: ['table'],
      })

      expect(rerun.failed).toBeUndefined()
      expect(rerun.applied).toMatchObject([{ action: 'adopt', key: 'leads' }])
      expect((await storedTable(workspaceId)).schema.columns.map((column) => column.name)).toEqual([
        'email',
        'status',
      ])
    }
  )

  check('a workflow may use a table the same apply adopts', async () => {
    const workspaceId = await newWorkspace()
    const { table: unbound } = await tableUseCases.createTableUseCase.execute({
      principal: owner,
      input: {
        workspaceId,
        name: 'leads',
        schema: { columns: [{ name: 'email', type: 'string', required: true }] },
      },
    })

    const result = await apply(workspaceId, STARTER)

    expect(result.failed).toBeUndefined()
    expect(result.applied.map(({ action, kind, key }) => `${action} ${kind}:${key}`)).toEqual([
      'adopt table:leads',
      'create workflow:ingest',
    ])
    const [ingest] = await workflows(workspaceId)
    const state = await loadWorkflowFromNormalizedTables(ingest.id)
    const tableIds = Object.values(state?.blocks ?? {}).map(
      (block) => block.subBlocks?.tableSelector?.value
    )
    expect(tableIds).toContain(unbound.id)
  })

  check(
    'a currency column declared without a code matches the stored USD: a server rename beside it is no conflict, and an edit carries no currency change',
    async () => {
      const workspaceId = await newWorkspace()
      const options = { kinds: ['table' as const], only: ['table' as const] }
      const declare = (description?: string) => ({
        'tables/deals.ts': LEADS.replace(
          "name: 'leads',",
          `name: 'deals',${description ? ` description: '${description}',` : ''}`
        ).replace('columns: {', 'columns: {\n    amount: column.currency(),'),
      })
      const created = await apply(
        workspaceId,
        { 'tables/deals.ts': LEADS.replace("name: 'leads'", "name: 'deals'") },
        options
      )
      const added = await apply(workspaceId, declare(), { ...options, base: created.base })
      expect(added.applied).toMatchObject([{ action: 'update', key: 'deals' }])
      const [deals] = await tables(workspaceId)
      // A server change makes an unmatched currency column read as a local edit, so as stale.
      await tableUseCases.updateTableUseCase.execute({
        principal: owner,
        input: { tableId: deals.id, workspaceId, name: 'deals_renamed' },
      })

      const untouched = await apply(workspaceId, declare(), { ...options, base: added.base })

      expect(untouched.plan.map(({ action, key }) => `${action} ${key}`)).toEqual(['noop deals'])

      const read = await get(workspaceId)
      const edited = await apply(workspaceId, declare('Won deals'), { ...options, base: read.base })

      expect(edited.plan.map(({ fields }) => fields)).toEqual([['name', 'description']])
    }
  )

  check(
    'a currency column stored in EUR and declared without a code moves to the default',
    async () => {
      const workspaceId = await newWorkspace()
      const options = { kinds: ['table' as const], only: ['table' as const] }
      const declare = (amount: string) => ({
        'tables/deals.ts': LEADS.replace("name: 'leads'", "name: 'deals'").replace(
          'columns: {',
          `columns: {\n    amount: ${amount},`
        ),
      })
      const created = await apply(
        workspaceId,
        declare("column.currency({ currencyCode: 'EUR' })"),
        options
      )
      expect(created.failed).toBeUndefined()

      const moved = await apply(workspaceId, declare('column.currency()'), {
        ...options,
        base: created.base,
      })

      expect(moved.failed).toBeUndefined()
      expect(moved.applied).toMatchObject([
        { action: 'update', key: 'deals', fields: ['columns.amount.currencyCode'] },
      ])
      const amount = (await storedTable(workspaceId)).schema.columns.find(
        (column) => column.name === 'amount'
      )
      expect(amount?.currencyCode ?? 'USD').toBe('USD')
      const again = await apply(workspaceId, declare('column.currency()'), {
        ...options,
        base: moved.base,
      })
      expect(again.plan.map(({ action }) => action)).toEqual(['noop'])
    }
  )

  check('an empty declared description is no description', async () => {
    const workspaceId = await newWorkspace()
    const options = { kinds: ['table' as const], only: ['table' as const] }
    const created = await apply(workspaceId, { 'tables/leads.ts': LEADS }, options)

    const renamed = await apply(
      workspaceId,
      { 'tables/leads.ts': LEADS.replace("name: 'leads',", "name: 'prospects', description: '',") },
      { ...options, base: created.base }
    )

    expect(renamed.applied).toMatchObject([{ action: 'update', fields: ['name'] }])
    expect((await storedTable(workspaceId)).description ?? null).toBeNull()
  })

  check(
    'dropping an empty column needs --allow-delete and shows in the destructive line',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const files = {
        ...read.files,
        'tables/leads.ts': read.files['tables/leads.ts'].replace(/\n\s*status: [^\n]*/, ''),
      }

      const refused = await refusal(apply(workspaceId, files, { base: read.base }))
      const planned = await apply(workspaceId, files, {
        base: read.base,
        allowDelete: true,
        dryRun: true,
      })

      expect(refused.diagnostics.find((finding) => finding.severity === 'error')?.message).toBe(
        'This drops 1 column(s) of "leads".'
      )
      expect(planned.plan).toMatchObject([
        { key: 'leads', destructive: { counts: { columns: 1, cells: 0 } } },
        { key: 'ingest' },
      ])
    }
  )

  check('warns that a base read from another workspace creates everything anew', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const otherId = await newWorkspace()

    const dryRun = await apply(otherId, read.files, { base: read.base, dryRun: true })

    expect(codes(dryRun.diagnostics, 'warning')).toEqual(['W_BASE_OTHER_WORKSPACE'])
    expect(dryRun.plan.map(({ action }) => action)).toEqual(['create', 'create'])
  })

  check('counts a type change’s unconvertible cells across every scan page', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const leads = await storedTable(workspaceId)
    const emailId = leads.schema.columns.find((column) => column.name === 'email')?.id ?? ''
    const pageSize = getColumnRetypeScanBatchSize()
    const values = Array.from({ length: pageSize * 2 + 1 }, (_, index) =>
      index % pageSize === 0 ? `bad-${index}` : String(index)
    )
    await db.insert(userTableRows).values(
      values.map((value, position) => ({
        id: generateId(),
        tableId: leads.id,
        workspaceId,
        data: { [emailId]: value },
        position,
      }))
    )
    const files = {
      ...read.files,
      'tables/leads.ts': read.files['tables/leads.ts'].replace(
        'column.string({ required: true })',
        'column.number({ required: true })'
      ),
    }

    const refused = await refusal(apply(workspaceId, files, { base: read.base }))

    expect(codes(refused.diagnostics)).toEqual(['E_TABLE_TYPE_CONVERSION'])
    expect(refused.diagnostics[0].message).toContain('3 cell(s)')
  })

  check('a directory that already holds the server’s change advances its base', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const [leads] = await tables(workspaceId)
    await tableUseCases.updateTableUseCase.execute({
      principal: owner,
      input: { tableId: leads.id, workspaceId, description: 'Shared' },
    })
    const same = {
      ...read.files,
      'tables/leads.ts': read.files['tables/leads.ts'].replace(
        "name: 'leads',",
        "name: 'leads',\n  description: 'Shared',"
      ),
    }

    const settled = await apply(workspaceId, same, { base: read.base })

    expect(settled.applied).toEqual([])
    const edited = {
      ...same,
      'tables/leads.ts': same['tables/leads.ts'].replace("'Shared'", "'Edited'"),
    }
    const next = await apply(workspaceId, edited, { base: settled.base })

    expect(next.applied).toMatchObject([{ action: 'update', key: 'leads' }])
  })

  check('a get leaves out of its kinds a kind the caller may not read', async () => {
    const workspaceId = await newWorkspace()
    await setUp(workspaceId)
    const refusing = vi
      .spyOn(listWorkflows, 'execute')
      .mockRejectedValue(new OrchestrationError('forbidden', 'Workflows are not readable.'))

    const read = await get(workspaceId).finally(() => refusing.mockRestore())

    expect(read.kinds).toEqual(['table'])
    expect(codes(read.diagnostics)).toEqual(['E_APPLY_FORBIDDEN'])
    expect(Object.keys(read.files)).toEqual(['tables/leads.ts'])
  })

  check('refuses two declarations of one table name before creating either', async () => {
    const workspaceId = await newWorkspace()

    const refused = await refusal(
      apply(
        workspaceId,
        { 'tables/a.ts': LEADS, 'tables/b.ts': LEADS.replace("name: 'leads'", "name: 'LEADS'") },
        { kinds: ['table'], only: ['table'] }
      )
    )

    expect(codes(refused.diagnostics)).toEqual(['E_NAME_TAKEN'])
    expect(await tables(workspaceId)).toEqual([])
  })

  check('a get prints a column named __proto__, and applying it back changes nothing', async () => {
    const workspaceId = await newWorkspace()
    await tableUseCases.createTableUseCase.execute({
      principal: owner,
      input: {
        workspaceId,
        name: 'leads',
        schema: {
          columns: [
            { name: '__proto__', type: 'string' },
            { name: 'email', type: 'string' },
          ],
        },
      },
    })

    const read = await get(workspaceId)

    expect(read.files['tables/leads.ts']).toContain("name: '__proto__'")
    expect(Object.keys(read.base.resources['table:leads']?.columns ?? {}).sort()).toEqual([
      '__proto___2',
      'email',
    ])
    const again = await apply(workspaceId, read.files, {
      base: read.base,
      kinds: ['table'],
      only: ['table'],
    })
    expect(again.plan.map((change) => change.action)).toEqual(['noop'])
  })
})
