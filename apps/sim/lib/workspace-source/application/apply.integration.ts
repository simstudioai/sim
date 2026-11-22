import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  auditLog,
  folder,
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
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import * as columnUseCases from '@/lib/table/application/columns'
import * as tableReshape from '@/lib/table/application/reshape'
import * as tableUseCases from '@/lib/table/application/tables'
import * as columnService from '@/lib/table/columns/service'
import { getTableById } from '@/lib/table/service'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import type { ApplyWorkspaceSourceInput } from '@/lib/workspace-source/application/apply-workspace-source'
import {
  codes,
  failKeyClaims,
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
    .orderBy(userTableDefinitions.id)
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

const TAGGED_LEADS = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'leads',
  columns: {
    email: column.string({ required: true }),
    tags: column.select({ options: ['a', 'b'], multiple: true }),
    rank: column.select({ options: ['1', '2'] }),
  },
})
`

const PAIRS = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'pairs',
  columns: {
    a: column.string(),
    b: column.string(),
  },
})
`

/** A workspace holding only a leads table with a multi-select and a numeric-named select column. */
async function taggedLeads(workspaceId: string) {
  const created = await apply(
    workspaceId,
    { 'tables/leads.ts': TAGGED_LEADS },
    { kinds: ['table'], only: ['table'] }
  )
  expect(created.failed).toBeUndefined()
  return get(workspaceId)
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
  /** Runs `run` with the workflow-code flag off, restoring it after. */
  async function flagOff(run: () => Promise<void>) {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async () => false)
    try {
      await run()
    } finally {
      featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
        async (flag: string) => flag === 'workflow-code'
      )
    }
  }

  check(
    'a real apply reports each finding of a written workflow once, as its dry run does',
    async () => {
      const workspaceId = await newWorkspace()
      const files = {
        ...STARTER,
        'workflows/ingest/workflow.ts': INGEST.replace(
          'data: { email: start.email },',
          'data: { email: start.email, note: env.QA_NOT_SET },'
        ).replace('import { table,', 'import { env, table,'),
      }
      const once = (diagnostics: ReadonlyArray<{ code: string; severity: string }>) =>
        codes(diagnostics, 'warning').filter((code) => code === 'W_ENV_UNKNOWN')

      const planned = await apply(workspaceId, files, { dryRun: true })
      expect(once(planned.diagnostics)).toEqual(['W_ENV_UNKNOWN'])
      const written = await apply(workspaceId, files)
      expect(written.failed).toBeUndefined()
      expect(once(written.diagnostics)).toEqual(['W_ENV_UNKNOWN'])
    }
  )

  check(
    'a workflow edited on both sides is refused as stale with the hint every other kind gives',
    async () => {
      const workspaceId = await newWorkspace()
      await apply(workspaceId, STARTER)
      const read = await get(workspaceId)
      const entry = 'workflows/ingest/workflow.ts'
      const renamedTo = (name: string) => ({
        ...read.files,
        [entry]: read.files[entry].replace("'Save Lead'", `'${name}'`),
      })
      await apply(workspaceId, renamedTo('Store Lead'), { base: read.base })

      const stale = await refusal(apply(workspaceId, renamedTo('Keep Lead'), { base: read.base }))

      expect(stale.diagnostics).toEqual([
        expect.objectContaining({
          code: 'E_APPLY_STALE',
          kind: 'workflow',
          key: 'ingest',
          hint: expect.stringContaining('sim workspaces source get'),
        }),
      ])
    }
  )

  check(
    'every audit entry an apply writes carries its apply id, and the next apply has another',
    async () => {
      const workspaceId = await newWorkspace()

      const first = await apply(workspaceId, STARTER)
      const second = await apply(
        workspaceId,
        { 'tables/leads.ts': LEADS.replace("'won'", "'won', 'lost'") },
        { base: first.base, kinds: ['table'] }
      )

      expect(first.applyId).toEqual(expect.any(String))
      expect(second.applyId).toEqual(expect.any(String))
      expect(second.applyId).not.toBe(first.applyId)
      await vi.waitFor(async () => {
        const rows = await db
          .select({ action: auditLog.action, metadata: auditLog.metadata })
          .from(auditLog)
          .where(eq(auditLog.workspaceId, workspaceId))
        const grouped = (applyId: string | undefined) =>
          rows
            .filter((row) => isRecordLike(row.metadata) && row.metadata.correlationId === applyId)
            .map((row) => row.action)
            .sort()
        expect(grouped(first.applyId)).toEqual([
          'table.created',
          'workflow.created',
          'workspace.updated',
        ])
        expect(grouped(second.applyId)).toEqual(
          expect.arrayContaining(['table.updated', 'workspace.updated'])
        )
      })
    }
  )

  check(
    'the commit and repository an apply names are in its audit entries, the workflow writes included',
    async () => {
      const workspaceId = await newWorkspace()
      const provenance = {
        client: 'cli' as const,
        gitSha: '0123abcd',
        repo: 'git@github.com:acme/flows.git',
      }

      const created = await apply(workspaceId, STARTER, { provenance })
      const read = await get(workspaceId)
      const updated = await apply(
        workspaceId,
        {
          ...read.files,
          'workflows/ingest/workflow.ts': read.files['workflows/ingest/workflow.ts'].replace(
            "'Save Lead'",
            "'Store Lead'"
          ),
        },
        { base: read.base, provenance }
      )
      expect(updated.applied.map(({ key, action }) => `${action} ${key}`)).toEqual([
        'update ingest',
      ])

      const recorded = async (applyId: string | undefined, workflowAction: string) => {
        const rows = await db
          .select({ action: auditLog.action, metadata: auditLog.metadata })
          .from(auditLog)
          .where(eq(auditLog.workspaceId, workspaceId))
        return rows
          .filter(
            (row) =>
              isRecordLike(row.metadata) &&
              row.metadata.correlationId === applyId &&
              (row.action === 'workspace.updated' || row.action === workflowAction)
          )
          .map((row) => row.metadata)
      }
      await vi.waitFor(async () => {
        for (const entries of [
          await recorded(created.applyId, 'workflow.created'),
          await recorded(updated.applyId, 'workflow.updated'),
        ]) {
          expect(entries).toHaveLength(2)
          for (const metadata of entries) {
            expect(metadata).toMatchObject({
              client: 'cli',
              gitSha: '0123abcd',
              repo: provenance.repo,
            })
          }
        }
      })
    }
  )

  check('the workflow-code flag off refuses a get, and no key is allocated', async () => {
    const workspaceId = await newWorkspace()
    await setUp(workspaceId)
    const keyRows = () =>
      db
        .select({ key: workspaceResourceKey.key })
        .from(workspaceResourceKey)
        .where(eq(workspaceResourceKey.workspaceId, workspaceId))
    await db.delete(workspaceResourceKey).where(eq(workspaceResourceKey.workspaceId, workspaceId))

    await flagOff(async () => {
      await expect(get(workspaceId)).rejects.toMatchObject({ code: 'forbidden' })
    })

    expect(await keyRows()).toEqual([])
  })

  check('the workflow-code flag off refuses an apply, and nothing is written', async () => {
    const workspaceId = await newWorkspace()
    const source = await setUp(workspaceId)
    const before = {
      tables: await tableSnapshot(workspaceId),
      workflows: await workflows(workspaceId),
    }
    const files = {
      ...source.files,
      'tables/leads.ts': LEADS.replace("name: 'leads'", "name: 'prospects'"),
    }

    await flagOff(async () => {
      await expect(apply(workspaceId, files, { base: source.base })).rejects.toMatchObject({
        code: 'forbidden',
      })
    })

    expect({
      tables: await tableSnapshot(workspaceId),
      workflows: await workflows(workspaceId),
    }).toEqual(before)
  })

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
      expect(codes(untouched.diagnostics, 'warning')).toContain('W_SERVER_CHANGED')
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
      expect(codes(untouched.diagnostics, 'warning')).toContain('W_SERVER_DELETED')
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
          schema: { columns: [{ name: 'email', type: 'string', required: true }] },
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
    'refuses deleting a table an edited workflow names in a form no text scan reads',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const files = Object.fromEntries(
        Object.entries(read.files)
          .filter(([path]) => path !== 'tables/leads.ts')
          .map(([path, text]) => [
            path,
            path === 'workflows/ingest/workflow.ts'
              ? text.replace("table('leads')", "table ( 'leads' )")
              : text,
          ])
      )
      expect(files['workflows/ingest/workflow.ts']).toContain("table ( 'leads' )")

      const refused = await refusal(
        apply(workspaceId, files, { base: read.base, allowDelete: true })
      )

      expect(codes(refused.diagnostics)).toEqual(['E_PLAN_REF_DELETED'])
      expect(refused.diagnostics[0]).toMatchObject({ kind: 'workflow', key: 'ingest' })
      expect(await tables(workspaceId)).toHaveLength(1)
    }
  )

  check(
    'refuses at plan time deleting the last workflow, and deletes it when the apply creates another',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const [ingest] = await workflows(workspaceId)
      const withoutIngest = Object.fromEntries(
        Object.entries(read.files).filter(([path]) => !path.startsWith('workflows/ingest/'))
      )

      const dryRun = await apply(workspaceId, withoutIngest, {
        base: read.base,
        allowDelete: true,
        dryRun: true,
      })

      expect(codes(dryRun.diagnostics)).toEqual(['E_APPLY_REFUSED'])
      expect(dryRun.diagnostics.find((finding) => finding.severity === 'error')).toMatchObject({
        kind: 'workflow',
        key: 'ingest',
        message: 'Cannot delete the only workflow in the workspace',
      })
      await refusal(apply(workspaceId, withoutIngest, { base: read.base, allowDelete: true }))
      expect((await workflows(workspaceId)).map((stored) => stored.id)).toEqual([ingest.id])

      const replaced = await apply(
        workspaceId,
        {
          ...withoutIngest,
          'workflows/intake/workflow.ts': INGEST.replace("workflow('Ingest'", "workflow('Intake'"),
        },
        { base: read.base, allowDelete: true }
      )

      expect(replaced.failed).toBeUndefined()
      expect(replaced.applied.map(({ kind, key, action }) => `${action} ${kind}:${key}`)).toEqual([
        'create workflow:intake',
        'delete workflow:ingest',
      ])
      expect((await workflows(workspaceId)).map((stored) => stored.name)).toEqual(['Intake'])
    }
  )

  check(
    'deletes a table whose id a declared workflow mentions only in its prompt text',
    async () => {
      const workspaceId = await newWorkspace()
      await apply(workspaceId, { 'tables/leads.ts': LEADS }, { kinds: ['table'], only: ['table'] })
      const [leads] = await tables(workspaceId)
      const created = await apply(
        workspaceId,
        {
          'tables/leads.ts': LEADS,
          'workflows/notes/workflow.ts': `// @sim-sdk 1
import { agent, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Notes', {}, () => {
  const start = trigger.start('Start', {})
  const writer = agent('Writer', {
    messages: [{ role: 'user', content: 'Rows once lived in table ${leads.id}, now archived.' }],
    model: 'gpt-5.5',
  })

  start.to(writer)
})
`,
        },
        { base: (await get(workspaceId)).base }
      )
      expect(created.failed).toBeUndefined()
      const read = await get(workspaceId)
      expect(read.files['workflows/notes/workflow.ts']).toContain(leads.id)
      // The CLI sends an unchanged workflow folder as its `.sim/` files alone.
      const files = Object.fromEntries(
        Object.entries(read.files).filter(
          ([path]) =>
            path !== 'tables/leads.ts' &&
            (!path.startsWith('workflows/notes/') || path.startsWith('workflows/notes/.sim/'))
        )
      )

      const deleted = await apply(workspaceId, files, { base: read.base, allowDelete: true })

      expect(codes(deleted.diagnostics, 'error')).toEqual([])
      expect(deleted.applied.map(({ kind, key, action }) => `${action} ${kind}:${key}`)).toEqual([
        'delete table:leads',
      ])
      expect(await tables(workspaceId)).toEqual([])
    }
  )

  check(
    'keeps a workflow’s comment-only edit, which changes no block, through the next get',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const path = 'workflows/ingest/workflow.ts'
      const files = {
        ...read.files,
        [path]: read.files[path].replace(
          /(\n\s*)const save = /,
          '$1// leads land here$1const save = '
        ),
      }
      expect(files[path]).toContain('// leads land here')

      const dryRun = await apply(workspaceId, files, { base: read.base, dryRun: true })
      expect(dryRun.plan.find((change) => change.key === 'ingest')?.action).toBe('update')
      const applied = await apply(workspaceId, files, { base: read.base })

      expect(applied.failed).toBeUndefined()
      expect((await get(workspaceId)).files[path]).toContain('// leads land here')
    }
  )

  check(
    'a plan comparing many folders and fingerprinting delete candidates binds no key and records no read',
    async () => {
      const workspaceId = await newWorkspace()
      const names = ['Ingest A', 'Ingest B', 'Ingest C', 'Ingest D', 'Doomed']
      const created = await apply(workspaceId, {
        ...STARTER,
        ...Object.fromEntries(
          names.map((name) => [
            `workflows/${name.toLowerCase().replace(' ', '-')}/workflow.ts`,
            INGEST.replace("workflow('Ingest'", `workflow('${name}'`),
          ])
        ),
      })
      expect(created.failed).toBeUndefined()
      const read = await get(workspaceId)
      const tableKeys = () =>
        db
          .select({ key: workspaceResourceKey.key })
          .from(workspaceResourceKey)
          .where(
            and(
              eq(workspaceResourceKey.workspaceId, workspaceId),
              eq(workspaceResourceKey.kind, 'table')
            )
          )
      expect(await tableKeys()).toEqual([{ key: 'leads' }])
      await db
        .delete(workspaceResourceKey)
        .where(
          and(
            eq(workspaceResourceKey.workspaceId, workspaceId),
            eq(workspaceResourceKey.kind, 'table')
          )
        )
      const files = Object.fromEntries(
        Object.entries(read.files).filter(([path]) => !path.startsWith('workflows/doomed/'))
      )
      posthogServerMockFns.mockCaptureServerEvent.mockClear()

      await apply(workspaceId, files, {
        base: read.base,
        kinds: ['workflow'],
        allowDelete: true,
        dryRun: true,
      }).catch(() => undefined)

      expect(await tableKeys()).toEqual([])
      expect(
        posthogServerMockFns.mockCaptureServerEvent.mock.calls.map(([, event]) => event)
      ).not.toContain('workflow_source_read')
    }
  )

  check('deletes a workflow the directory no longer declares, with --allow-delete', async () => {
    const workspaceId = await newWorkspace()
    await apply(workspaceId, {
      ...STARTER,
      'workflows/intake/workflow.ts': INGEST.replace("workflow('Ingest'", "workflow('Intake'"),
    })
    const read = await get(workspaceId)
    const files = Object.fromEntries(
      Object.entries(read.files).filter(([path]) => !path.startsWith('workflows/ingest/'))
    )

    const result = await apply(workspaceId, files, { base: read.base, allowDelete: true })

    expect(result.failed).toBeUndefined()
    expect(result.applied.map(({ kind, key, action }) => `${action} ${kind}:${key}`)).toEqual([
      'delete workflow:ingest',
    ])
    expect((await workflows(workspaceId)).map((stored) => stored.name)).toEqual(['Intake'])
    expect(result.base.resources['workflow:ingest']).toBeUndefined()
  })

  check(
    'refuses deleting a workflow edited on the server since the directory was read',
    async () => {
      const workspaceId = await newWorkspace()
      await apply(workspaceId, {
        ...STARTER,
        'workflows/intake/workflow.ts': INGEST.replace("workflow('Ingest'", "workflow('Intake'"),
      })
      const read = await get(workspaceId)
      const edited = await apply(
        workspaceId,
        {
          ...read.files,
          'workflows/ingest/workflow.ts': read.files['workflows/ingest/workflow.ts'].replace(
            "'Save Lead'",
            "'Store Lead'"
          ),
        },
        { base: read.base }
      )
      expect(edited.applied.map(({ key }) => key)).toEqual(['ingest'])
      const files = Object.fromEntries(
        Object.entries(read.files).filter(([path]) => !path.startsWith('workflows/ingest/'))
      )

      const stale = await refusal(apply(workspaceId, files, { base: read.base, allowDelete: true }))

      expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect(stale.diagnostics[0]).toMatchObject({ kind: 'workflow', key: 'ingest' })
      expect((await workflows(workspaceId)).map((stored) => stored.name).sort()).toEqual([
        'Ingest',
        'Intake',
      ])
    }
  )

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
    'counts only the workflows an apply evaluates toward its workflow limit, not unchanged folders',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const unchanged = Object.fromEntries(
        Array.from({ length: WORKSPACE_SOURCE_LIMITS.maxWorkflows + 1 }, (_, index) => [
          `workflows/copy-${index}/.sim/base.json`,
          read.files['workflows/ingest/.sim/base.json'],
        ])
      )

      const result = await apply(
        workspaceId,
        { 'tables/leads.ts': read.files['tables/leads.ts'], ...unchanged },
        { base: read.base, dryRun: true }
      )

      expect(codes(result.diagnostics)).toEqual([])
      expect(
        result.plan.filter((change) => change.kind === 'workflow' && change.action === 'noop')
      ).toHaveLength(WORKSPACE_SOURCE_LIMITS.maxWorkflows + 1)
    }
  )

  check('renames a schema-locked table, since its name is not part of its schema', async () => {
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
        "name: 'leads',",
        "name: 'prospects',"
      ),
    }

    const result = await apply(workspaceId, files, { base: read.base })

    expect(result.failed).toBeUndefined()
    expect((await tables(workspaceId)).map((table) => table.name)).toEqual(['prospects'])
  })

  check(
    'refuses at plan time a unique column whose rows share a value, writing nothing',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await taggedLeads(workspaceId)
      await insertRow(workspaceId, { email: 'a@b.c' })
      await insertRow(workspaceId, { email: 'a@b.c' })
      const files = {
        'tables/leads.ts': read.files['tables/leads.ts']
          .replace("name: 'leads',", "name: 'leads',\n  description: 'Inbound leads',")
          .replace(
            'column.string({ required: true })',
            'column.string({ required: true, unique: true })'
          ),
      }
      const before = await tableSnapshot(workspaceId)

      const refused = await refusal(apply(workspaceId, files, { base: read.base, only: ['table'] }))

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_REFUSED'])
      expect(refused.diagnostics[0].message).toContain('"email" cannot become unique')
      expect(await tableSnapshot(workspaceId)).toEqual(before)
    }
  )

  check(
    'refuses at plan time to drop a column of a delete-locked table, writing nothing',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const [leads] = await tables(workspaceId)
      await db
        .update(userTableDefinitions)
        .set({ deleteLocked: true })
        .where(eq(userTableDefinitions.id, leads.id))
      const files = {
        ...read.files,
        'tables/leads.ts': read.files['tables/leads.ts'].replace(/\n {4}status: .*\n/, '\n'),
      }
      const before = await tableSnapshot(workspaceId)

      const locked = await refusal(
        apply(workspaceId, files, { base: read.base, allowDelete: true })
      )

      expect(locked.code).toBe('locked')
      expect(codes(locked.diagnostics)).toEqual(['E_APPLY_LOCKED'])
      expect(await tableSnapshot(workspaceId)).toEqual(before)
    }
  )

  check(
    'refuses removing an option a multi-select cell keeps beside others without --allow-delete',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await taggedLeads(workspaceId)
      const [a, b] = [
        await optionId(workspaceId, 'tags', 'a'),
        await optionId(workspaceId, 'tags', 'b'),
      ]
      await insertRow(workspaceId, { email: 'a@b.c', tags: [a, b] })
      const files = { 'tables/leads.ts': read.files['tables/leads.ts'].replace("'a', 'b'", "'a'") }
      const before = await tableSnapshot(workspaceId)

      const refused = await refusal(apply(workspaceId, files, { base: read.base, only: ['table'] }))

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect(refused.diagnostics[0].message).toContain('losing 1 cell(s)')
      expect(await tableSnapshot(workspaceId)).toEqual(before)
    }
  )

  check(
    'renames an option’s letter case on a delete-locked table, since it keeps the option',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await taggedLeads(workspaceId)
      const a = await optionId(workspaceId, 'tags', 'a')
      await insertRow(workspaceId, { email: 'a@b.c', tags: [a] })
      const { id } = await storedTable(workspaceId)
      await db
        .update(userTableDefinitions)
        .set({ deleteLocked: true })
        .where(eq(userTableDefinitions.id, id))
      const files = {
        'tables/leads.ts': read.files['tables/leads.ts'].replace("'a', 'b'", "'A', 'b'"),
      }

      const renamed = await apply(workspaceId, files, { base: read.base, only: ['table'] })

      expect(renamed.failed).toBeUndefined()
      expect(codes(renamed.diagnostics, 'error')).toEqual([])
      expect(await optionId(workspaceId, 'tags', 'A')).toBe(a)
    }
  )

  check(
    'refuses as stale a change to a table whose column the server replaced with a same-named one',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await taggedLeads(workspaceId)
      const { id: tableId } = await storedTable(workspaceId)
      await columnUseCases.deleteTableColumnUseCase.execute({
        principal: owner,
        input: { tableId, workspaceId, columnName: 'rank' },
      })
      await columnUseCases.addTableColumnUseCase.execute({
        principal: owner,
        input: {
          tableId,
          workspaceId,
          column: {
            name: 'rank',
            type: 'select',
            options: [
              { id: generateId(), name: '1' },
              { id: generateId(), name: '2' },
            ],
          },
        },
      })
      await insertRow(workspaceId, {
        email: 'a@b.c',
        rank: await optionId(workspaceId, 'rank', '1'),
      })
      const files = {
        'tables/leads.ts': read.files['tables/leads.ts'].replace(
          "name: 'leads',",
          "name: 'leads',\n  description: 'Inbound leads',"
        ),
      }
      const before = await tableSnapshot(workspaceId)

      const refused = await refusal(
        apply(workspaceId, files, { base: read.base, only: ['table'], allowDelete: true })
      )

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect(await tableSnapshot(workspaceId)).toEqual(before)
    }
  )

  check(
    'refuses at plan time a switch to single-select while a row keeps several options, and allows it once a removal leaves one',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await taggedLeads(workspaceId)
      const [a, b] = [
        await optionId(workspaceId, 'tags', 'a'),
        await optionId(workspaceId, 'tags', 'b'),
      ]
      await insertRow(workspaceId, { email: 'a@b.c', tags: [a, b] })
      const single = (options: string) => ({
        'tables/leads.ts': read.files['tables/leads.ts'].replace(
          "options: ['a', 'b'], multiple: true",
          `options: [${options}]`
        ),
      })
      const before = await tableSnapshot(workspaceId)

      const refused = await refusal(
        apply(workspaceId, single("'a', 'b'"), { base: read.base, only: ['table'] })
      )

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_REFUSED'])
      expect(refused.diagnostics[0].message).toContain('1 row(s) keep several options')
      expect(await tableSnapshot(workspaceId)).toEqual(before)

      const narrowed = await apply(workspaceId, single("'a'"), {
        base: read.base,
        only: ['table'],
        allowDelete: true,
      })

      expect(narrowed.failed).toBeUndefined()
      const tags = (await storedTable(workspaceId)).schema.columns.find(
        (column) => column.name === 'tags'
      )
      expect(tags?.multiple).toBeFalsy()
    }
  )

  check('converts a select column to numbers by its option names', async () => {
    const workspaceId = await newWorkspace()
    const read = await taggedLeads(workspaceId)
    await insertRow(workspaceId, {
      email: 'a@b.c',
      rank: await optionId(workspaceId, 'rank', '2'),
    })
    const files = {
      'tables/leads.ts': read.files['tables/leads.ts'].replace(
        "rank: column.select({ options: ['1', '2'] })",
        'rank: column.number()'
      ),
    }
    expect(files['tables/leads.ts']).toContain('rank: column.number()')

    const result = await apply(workspaceId, files, { base: read.base, only: ['table'] })

    expect(result.failed).toBeUndefined()
    const [row] = await db
      .select({ data: userTableRows.data })
      .from(userTableRows)
      .where(eq(userTableRows.workspaceId, workspaceId))
    const rank = (await storedTable(workspaceId)).schema.columns.find(
      (column) => column.name === 'rank'
    )
    expect(rank?.type).toBe('number')
    expect((row.data as Record<string, unknown>)[rank?.id ?? '']).toBe(2)
  })

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
    'a table update that fails mid-reshape commits nothing, and a re-run applies it whole',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      await insertRow(workspaceId, {
        email: 'a@b.c',
        status: await optionId(workspaceId, 'status', 'won'),
      })
      const files = {
        ...read.files,
        'tables/leads.ts': read.files['tables/leads.ts']
          .replace("name: 'leads',", "name: 'leads',\n  description: 'Inbound leads',")
          .replace(/\n {4}status: .*\n/, '\n')
          .replace(
            'email: column.string({ required: true })',
            "email: column.string({ name: 'contact', required: true })"
          )
          .replace('columns: {', 'columns: {\n    score: column.number(),'),
      }
      const before = await tableSnapshot(workspaceId)
      const rows = await db
        .select()
        .from(userTableRows)
        .where(eq(userTableRows.workspaceId, workspaceId))
      const failing = vi
        .spyOn(columnService, 'addTableColumn')
        .mockRejectedValue(new Error('connection reset'))

      let adds = 0
      const failed = await apply(workspaceId, files, {
        base: read.base,
        allowDelete: true,
      }).finally(() => {
        adds = failing.mock.calls.length
        failing.mockRestore()
      })

      expect(failed.failed).toMatchObject({ kind: 'table', key: 'leads', code: 'E_APPLY_FAILED' })
      expect(adds).toBe(1)
      expect(await tableSnapshot(workspaceId)).toEqual(before)
      expect(
        await db.select().from(userTableRows).where(eq(userTableRows.workspaceId, workspaceId))
      ).toEqual(rows)
      expect(failed.base.resources['table:leads']).toEqual(read.base.resources['table:leads'])

      const rerun = await apply(workspaceId, files, { base: failed.base, allowDelete: true })

      expect(rerun.failed).toBeUndefined()
      expect(rerun.plan.find((change) => change.key === 'leads')?.fields).toEqual(
        expect.arrayContaining(['description', 'columns.status (drop)', 'columns.score (add)'])
      )
      const table = await storedTable(workspaceId)
      expect(table.description).toBe('Inbound leads')
      expect(table.schema.columns.map((column) => column.name)).toEqual(['contact', 'score'])
    }
  )

  check('a table reshape commits its fields and every column change together', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    await insertRow(workspaceId, { email: 'a@b.c' })
    const { id: tableId } = await storedTable(workspaceId)
    const emailId = (await storedTable(workspaceId)).schema.columns.find(
      (column) => column.name === 'email'
    )?.id
    const files = {
      ...read.files,
      'tables/leads.ts': read.files['tables/leads.ts']
        .replace("name: 'leads',", "name: 'leads',\n  description: 'Inbound leads',")
        .replace(/\n {4}status: .*\n/, '\n')
        .replace(
          'email: column.string({ required: true })',
          "email: column.string({ name: 'contact', required: true })"
        )
        .replace('columns: {', 'columns: {\n    score: column.number(),'),
    }
    const reshape = vi.spyOn(tableReshape.reshapeTableUseCase, 'execute')

    let reshapes = 0
    const result = await apply(workspaceId, files, { base: read.base, allowDelete: true }).finally(
      () => {
        reshapes = reshape.mock.calls.length
        reshape.mockRestore()
      }
    )

    expect(result.failed).toBeUndefined()
    expect(reshapes).toBe(1)
    const table = await storedTable(workspaceId)
    expect(table.id).toBe(tableId)
    expect(table.description).toBe('Inbound leads')
    expect(table.schema.columns.map(({ name, type }) => `${name}:${type}`)).toEqual([
      'contact:string',
      'score:number',
    ])
    const [row] = await db
      .select({ data: userTableRows.data })
      .from(userTableRows)
      .where(eq(userTableRows.workspaceId, workspaceId))
    expect((row.data as Record<string, unknown>)[emailId ?? '']).toBe('a@b.c')
    const again = await apply(workspaceId, { ...files, ...result.files }, { base: result.base })
    expect(again.plan.find((change) => change.key === 'leads')?.action).toBe('noop')
    // The audit names each column, as the single-column use cases do, never its id.
    await vi.waitFor(async () => {
      const descriptions = (
        await db
          .select({ description: auditLog.description })
          .from(auditLog)
          .where(eq(auditLog.workspaceId, workspaceId))
      ).map((entry) => entry.description)
      expect(descriptions).toContain('Deleted column "status" from table "leads"')
      expect(descriptions).toContain('Updated column "email" in table "leads"')
    })
  })

  check(
    'renames columns into names other renames free, a chain and a swap, keeping their cells',
    async () => {
      const workspaceId = await newWorkspace()
      const created = await apply(
        workspaceId,
        { 'tables/pairs.ts': PAIRS },
        { kinds: ['table'], only: ['table'] }
      )
      expect(created.failed).toBeUndefined()
      const read = await get(workspaceId)
      await insertRow(workspaceId, { a: 'first', b: 'second' })
      const cellsByName = async () => {
        const table = await storedTable(workspaceId)
        const [row] = await db
          .select({ data: userTableRows.data })
          .from(userTableRows)
          .where(eq(userTableRows.workspaceId, workspaceId))
        const data = row.data as Record<string, unknown>
        return Object.fromEntries(
          table.schema.columns.map((column) => [column.name, data[column.id ?? column.name]])
        )
      }
      const declare = (a: string, b: string) => ({
        'tables/pairs.ts': PAIRS.replace(
          'a: column.string(),\n    b: column.string(),',
          `a: column.string({ name: '${a}' }),\n    b: column.string({ name: '${b}' }),`
        ),
      })

      const chained = await apply(workspaceId, declare('b', 'c'), {
        base: read.base,
        only: ['table'],
      })

      expect(chained.failed).toBeUndefined()
      expect(await cellsByName()).toEqual({ b: 'first', c: 'second' })

      const swapped = await apply(workspaceId, declare('c', 'b'), {
        base: chained.base,
        only: ['table'],
      })

      expect(swapped.failed).toBeUndefined()
      expect(await cellsByName()).toEqual({ c: 'first', b: 'second' })
    }
  )

  check('a reshape swapping two columns addressed by name keeps their cells', async () => {
    const workspaceId = await newWorkspace()
    const created = await apply(
      workspaceId,
      { 'tables/pairs.ts': PAIRS },
      { kinds: ['table'], only: ['table'] }
    )
    expect(created.failed).toBeUndefined()
    await insertRow(workspaceId, { a: 'first', b: 'second' })
    const { id: tableId } = await storedTable(workspaceId)

    await tableReshape.reshapeTableUseCase.execute({
      principal: owner,
      input: {
        tableId,
        workspaceId,
        update: [
          { columnName: 'a', updates: { name: 'b' } },
          { columnName: 'b', updates: { name: 'a' } },
        ],
      },
    })

    const table = await storedTable(workspaceId)
    const [row] = await db
      .select({ data: userTableRows.data })
      .from(userTableRows)
      .where(eq(userTableRows.workspaceId, workspaceId))
    const data = row.data as Record<string, unknown>
    expect(
      Object.fromEntries(
        table.schema.columns.map((column) => [column.name, data[column.id ?? column.name]])
      )
    ).toEqual({ b: 'first', a: 'second' })
  })

  check('moves a one-per-table column type from one column to another in one apply', async () => {
    const workspaceId = await newWorkspace()
    const declare = (ttl: 'a' | 'b') => ({
      'tables/pairs.ts': PAIRS.replace(
        'a: column.string(),\n    b: column.string(),',
        ttl === 'a'
          ? 'a: column.ttl(),\n    b: column.string(),'
          : 'a: column.string(),\n    b: column.ttl(),'
      ),
    })
    const types = async () =>
      (await storedTable(workspaceId)).schema.columns.map((column) => [column.name, column.type])
    const created = await apply(workspaceId, declare('b'), { kinds: ['table'], only: ['table'] })
    expect(created.failed).toBeUndefined()

    const moved = await apply(workspaceId, declare('a'), { base: created.base, only: ['table'] })
    const back = await apply(workspaceId, declare('b'), { base: moved.base, only: ['table'] })

    expect([moved.failed, back.failed]).toEqual([undefined, undefined])
    expect(await types()).toEqual([
      ['a', 'string'],
      ['b', 'ttl'],
    ])
  })

  check(
    'an adopt whose changes fail leaves the table unbound and unchanged, and a re-run adopts it',
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
      const before = await tableSnapshot(workspaceId)
      const failing = vi
        .spyOn(columnService, 'addTableColumn')
        .mockRejectedValue(new Error('connection reset'))

      const failed = await apply(workspaceId, files, {
        kinds: ['table'],
        only: ['table'],
      }).finally(() => failing.mockRestore())

      expect(failed.failed).toMatchObject({ kind: 'table', key: 'leads' })
      expect(failed.base.resources['table:leads']).toBeUndefined()
      expect(await tableSnapshot(workspaceId)).toEqual(before)

      const rerun = await apply(workspaceId, files, {
        base: failed.base,
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

  check(
    'a workflow source apply warns on a row write naming a column its table no longer has',
    async () => {
      const workspaceId = await newWorkspace()
      await setUp(workspaceId)
      const [leads] = await tables(workspaceId)
      await columnUseCases.updateTableColumnUseCase.execute({
        principal: owner,
        input: {
          tableId: leads.id,
          workspaceId,
          columnName: 'email',
          updates: { name: 'contact' },
        },
      })
      const [ingest] = await workflows(workspaceId)
      const source = await withPermissionGroupScope(() =>
        readWorkflowSource.execute({ principal: owner, input: { workflowId: ingest.id } })
      )
      const applySource = (files: Record<string, string>, dryRun: boolean) =>
        withPermissionGroupScope(() =>
          applyWorkflowSource.execute({
            principal: owner,
            input: {
              workflowId: ingest.id,
              files,
              lock: source.lock,
              base: source.base,
              dryRun,
            },
          })
        )
      const unknownColumns = <D extends { code: string }>(diagnostics: readonly D[]) =>
        diagnostics.filter((finding) => finding.code === 'W_TABLE_UNKNOWN_COLUMN')
      const stale = {
        ...source.files,
        'workflow.ts': source.files['workflow.ts'].replace(
          'data: { email: start.email }',
          "data: { email: start.email, status: 'new' }"
        ),
      }

      const dryRun = await applySource(stale, true)

      expect(unknownColumns(dryRun.diagnostics)).toEqual([
        expect.objectContaining({
          severity: 'warning',
          message: 'data writes email, which is not a column of table "leads"; the run drops it.',
          hint: "The table's columns are contact, status.",
          file: 'workflow.ts',
        }),
      ])
      const fixed = await applySource(
        {
          ...source.files,
          'workflow.ts': source.files['workflow.ts'].replace(
            'data: { email: start.email }',
            'data: { contct: start.email }'
          ),
        },
        true
      )
      expect(unknownColumns(fixed.diagnostics).map((finding) => finding.hint)).toEqual([
        'Did you mean contact?',
      ])
      const correct = await applySource(
        {
          ...source.files,
          'workflow.ts': source.files['workflow.ts'].replace(
            'data: { email: start.email }',
            'data: { contact: start.email }'
          ),
        },
        true
      )
      expect(unknownColumns(correct.diagnostics)).toEqual([])

      // Applied, the write keeps the warning: it names the key the run drops.
      const applied = await applySource(stale, false)
      expect(applied.applied).toBe(true)
      expect(unknownColumns(applied.diagnostics).map((finding) => finding.message)).toEqual([
        'data writes email, which is not a column of table "leads"; the run drops it.',
      ])
    }
  )

  check(
    'a workspace source dry run checks row writes against the columns the directory declares',
    async () => {
      const workspaceId = await newWorkspace()
      const unknownColumns = (
        diagnostics: ReadonlyArray<{ code: string; key?: string; message: string }>
      ) =>
        diagnostics
          .filter((finding) => finding.code === 'W_TABLE_UNKNOWN_COLUMN')
          .map((finding) => `${finding.key}: ${finding.message}`)
      const renamedLeads = (files: Record<string, string>) =>
        files['tables/leads.ts'].replace(
          'email: column.string({ required: true })',
          "email: column.string({ name: 'contact', required: true })"
        )

      // A table the same apply creates: its declared columns stand in for a schema not yet stored.
      const created = await apply(
        workspaceId,
        { ...STARTER, 'tables/leads.ts': renamedLeads(STARTER) },
        { dryRun: true }
      )
      expect(unknownColumns(created.diagnostics)).toEqual([
        'ingest: data writes email, which is not a column of table "leads"; the run drops it.',
      ])

      // A column the same apply renames: the workflow is checked against the renamed column, not
      // the stored one it is about to replace.
      const read = await setUp(workspaceId)
      const ingest = 'workflows/ingest/workflow.ts'
      const stale = await apply(
        workspaceId,
        {
          ...read.files,
          'tables/leads.ts': renamedLeads(read.files),
          [ingest]: read.files[ingest].replace(
            'data: { email: start.email }',
            "data: { email: start.email, status: 'new' }"
          ),
        },
        { base: read.base, dryRun: true }
      )
      expect(unknownColumns(stale.diagnostics)).toEqual([
        'ingest: data writes email, which is not a column of table "leads"; the run drops it.',
      ])
      const followed = await apply(
        workspaceId,
        {
          ...read.files,
          'tables/leads.ts': renamedLeads(read.files),
          [ingest]: read.files[ingest].replace(
            'data: { email: start.email }',
            'data: { contact: start.email }'
          ),
        },
        { base: read.base, dryRun: true }
      )
      expect(codes(followed.diagnostics)).toEqual([])
      expect(unknownColumns(followed.diagnostics)).toEqual([])
    }
  )

  check(
    'refuses a workflow naming by id a table or child workflow of another workspace, and accepts its own',
    async () => {
      const other = await newWorkspace()
      const theirs = await apply(other, STARTER)
      expect(theirs.failed).toBeUndefined()
      const workspaceId = await newWorkspace()
      const ours = await apply(workspaceId, STARTER)
      expect(ours.failed).toBeUndefined()
      const probe = (tableId: string, workflowId: string) => ({
        'workflows/probe/workflow.ts': `// @sim-sdk 1
import { runWorkflow, table, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Probe', {}, () => {
  const start = trigger.start('Start', { inputFormat: { email: 'string' } })
  const save = table.insertRow('Save Lead', {
    tableId: '${tableId}',
    data: { email: start.email },
  })
  const child = runWorkflow('Child', { workflowId: '${workflowId}' })

  start.to(save)
  save.to(child)
})
`,
      })
      const idOf = (result: typeof ours, address: keyof typeof ours.base.resources) =>
        result.base.resources[address]?.id ?? ''

      const refused = await refusal(
        apply(workspaceId, probe(idOf(theirs, 'table:leads'), idOf(theirs, 'workflow:ingest')), {
          base: ours.base,
        })
      )

      const foreign = refused.diagnostics.filter(
        (finding) => finding.code === 'E_MAT_UNKNOWN_RESOURCE'
      )
      expect(foreign.map((finding) => finding.message).sort()).toEqual([
        expect.stringContaining(`No table "${idOf(theirs, 'table:leads')}" in this workspace`),
        expect.stringContaining(
          `No workflow "${idOf(theirs, 'workflow:ingest')}" in this workspace`
        ),
      ])
      expect(foreign.map((finding) => finding.file)).toEqual([
        'workflows/probe/workflow.ts',
        'workflows/probe/workflow.ts',
      ])

      const own = await apply(
        workspaceId,
        probe(idOf(ours, 'table:leads'), idOf(ours, 'workflow:ingest')),
        { kinds: ['workflow'], only: ['workflow'], dryRun: true }
      )
      expect(codes(own.diagnostics)).toEqual([])
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
    const pageSize = columnService.getColumnRetypeScanBatchSize()
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

  check(
    'refuses an edited copy of a workflow folder instead of writing it over the original',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const [original] = await workflows(workspaceId)
      const copy = Object.fromEntries(
        Object.entries(read.files)
          .filter(([path]) => path.startsWith('workflows/ingest/'))
          .map(([path, text]) => [
            path.replace('workflows/ingest/', 'workflows/ingest-v2/'),
            path.endsWith('workflow.ts')
              ? text.replace("'Ingest'", "'Ingest v2'").replace("'Save Lead'", "'Store Lead'")
              : text,
          ])
      )

      const refused = await refusal(
        apply(workspaceId, { ...read.files, ...copy }, { base: read.base })
      )

      expect(codes(refused.diagnostics, 'error')).toEqual(['E_WORKFLOW_FOLDER_COPIED'])
      expect(refused.diagnostics.find((finding) => finding.severity === 'error')).toMatchObject({
        key: 'ingest-v2',
        file: 'workflows/ingest-v2/.sim/base.json',
      })
      const stored = await readWorkflowSource.execute({
        principal: owner,
        input: { workflowId: original.id },
      })
      expect(stored.files['workflow.ts']).not.toContain('Store Lead')
      expect(await workflows(workspaceId)).toHaveLength(1)
    }
  )

  check(
    'refuses two new workflow folders that compile to one name before creating either',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const nightly = INGEST.replace("'Ingest'", "'Nightly'")
      const files = {
        ...read.files,
        'workflows/nightly-a/workflow.ts': nightly,
        'workflows/nightly-b/workflow.ts': nightly,
      }

      const dry = await apply(workspaceId, files, { base: read.base, dryRun: true })

      expect(codes(dry.diagnostics, 'error')).toEqual(['E_NAME_TAKEN'])
      expect(dry.diagnostics.find((finding) => finding.severity === 'error')?.key).toBe('nightly-b')
      await refusal(apply(workspaceId, files, { base: read.base }))
      expect(await workflows(workspaceId)).toHaveLength(1)
    }
  )

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

  check(
    'refuses at plan time deleting a delete-locked table or a locked workflow, writing nothing',
    async () => {
      const workspaceId = await newWorkspace()
      await apply(workspaceId, {
        ...STARTER,
        'tables/stale.ts': LEADS.replace("name: 'leads'", "name: 'stale'"),
        'workflows/old/workflow.ts': INGEST.replace("workflow('Ingest'", "workflow('Old'"),
        'workflows/filed/workflow.ts': INGEST.replace("workflow('Ingest'", "workflow('Filed'"),
      })
      const read = await get(workspaceId)
      const id = (address: keyof typeof read.base.resources) =>
        read.base.resources[address]?.id ?? ''
      await db
        .update(userTableDefinitions)
        .set({ deleteLocked: true })
        .where(eq(userTableDefinitions.id, id('table:stale')))
      await db
        .update(workflow)
        .set({ locked: true })
        .where(eq(workflow.id, id('workflow:old')))
      const folderId = generateId()
      await db.insert(folder).values({
        id: folderId,
        resourceType: 'workflow',
        name: 'Locked',
        userId: ownerId,
        workspaceId,
        locked: true,
      })
      await db
        .update(workflow)
        .set({ folderId })
        .where(eq(workflow.id, id('workflow:filed')))
      const files = {
        ...Object.fromEntries(
          Object.entries(read.files).filter(
            ([path]) =>
              path !== 'tables/stale.ts' &&
              !path.startsWith('workflows/old/') &&
              !path.startsWith('workflows/filed/')
          )
        ),
        'tables/leads.ts': read.files['tables/leads.ts'].replace(
          'status:',
          'notes: column.string(),\n    status:'
        ),
      }
      const before = await tableSnapshot(workspaceId)

      const dryRun = await apply(workspaceId, files, {
        base: read.base,
        allowDelete: true,
        dryRun: true,
      })
      expect(
        dryRun.diagnostics
          .filter((finding) => finding.severity === 'error')
          .map((finding) => `${finding.code} ${finding.kind}:${finding.key}`)
          .sort()
      ).toEqual([
        'E_APPLY_LOCKED table:stale',
        'E_APPLY_LOCKED workflow:filed',
        'E_APPLY_LOCKED workflow:old',
      ])
      const locked = await refusal(
        apply(workspaceId, files, { base: read.base, allowDelete: true })
      )
      expect(locked.code).toBe('locked')
      expect(await tableSnapshot(workspaceId)).toEqual(before)
      expect((await workflows(workspaceId)).length).toBe(3)
    }
  )

  check('refuses at plan time a retype to unique whose converted values collide', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const withCode = read.files['tables/leads.ts'].replace(
      'status:',
      'code: column.string(),\n    status:'
    )
    const added = await apply(
      workspaceId,
      { ...read.files, 'tables/leads.ts': withCode },
      { base: read.base }
    )
    expect(added.failed).toBeUndefined()
    await insertRow(workspaceId, { email: 'a@x.io', code: '1' })
    await insertRow(workspaceId, { email: 'b@x.io', code: '01' })
    const again = await get(workspaceId)
    const files = {
      ...again.files,
      'tables/leads.ts': again.files['tables/leads.ts'].replace(
        'code: column.string()',
        'code: column.number({ unique: true })'
      ),
    }
    const before = await tableSnapshot(workspaceId)

    const dryRun = await apply(workspaceId, files, { base: again.base, dryRun: true })
    const refusalFinding = dryRun.diagnostics.find((finding) => finding.severity === 'error')
    expect(refusalFinding).toMatchObject({ code: 'E_APPLY_REFUSED', kind: 'table', key: 'leads' })
    expect(refusalFinding?.message).toContain('equal once converted')
    await refusal(apply(workspaceId, files, { base: again.base }))
    expect(await tableSnapshot(workspaceId)).toEqual(before)
  })

  check('refuses adding a required column to a table that has rows', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    await insertRow(workspaceId, { email: 'a@x.io' })
    await insertRow(workspaceId, { email: 'b@x.io' })
    const files = {
      ...read.files,
      'tables/leads.ts': read.files['tables/leads.ts'].replace(
        'status:',
        'owner: column.string({ required: true }),\n    status:'
      ),
    }
    const before = await tableSnapshot(workspaceId)

    const refused = await refusal(apply(workspaceId, files, { base: read.base }))

    expect(codes(refused.diagnostics)).toEqual(['E_APPLY_REFUSED'])
    expect(refused.diagnostics[0]?.message).toContain('2 row(s)')
    expect(await tableSnapshot(workspaceId)).toEqual(before)
  })

  check('counts the blocks an edited workflow removes as a delete in its plan entry', async () => {
    const workspaceId = await newWorkspace()
    await apply(workspaceId, STARTER)
    const read = await get(workspaceId)
    const entry = 'workflows/ingest/workflow.ts'
    const files = {
      ...read.files,
      [entry]: `// @sim-sdk 1
import { trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Ingest', {}, () => {
  trigger.start('Start', { inputFormat: { email: 'string' } })
})
`,
    }

    const planned = await apply(workspaceId, files, {
      base: read.base,
      dryRun: true,
      allowDelete: true,
    })

    expect(planned.plan.find((change) => change.key === 'ingest')).toMatchObject({
      action: 'update',
      fields: expect.arrayContaining(['blocks -1']),
      destructive: { what: 'blocks', counts: { blocks: 1 } },
    })
  })

  check(
    'renames a workflow its folder renames, and refuses a name another workflow holds',
    async () => {
      const workspaceId = await newWorkspace()
      await apply(workspaceId, {
        ...STARTER,
        'workflows/intake/workflow.ts': INGEST.replace("workflow('Ingest'", "workflow('Intake'"),
      })
      const read = await get(workspaceId)
      const entry = 'workflows/ingest/workflow.ts'
      const renamedTo = (name: string) => ({
        ...read.files,
        [entry]: read.files[entry].replace("workflow('Ingest'", `workflow('${name}'`),
      })

      const taken = await refusal(apply(workspaceId, renamedTo('Intake'), { base: read.base }))
      expect(taken.diagnostics.find((finding) => finding.severity === 'error')).toMatchObject({
        code: 'E_NAME_TAKEN',
        kind: 'workflow',
        key: 'ingest',
        file: entry,
      })
      const created = 'workflows/copy/workflow.ts'
      const createTaken = await apply(
        workspaceId,
        { ...read.files, [created]: INGEST.replace("workflow('Ingest'", "workflow('Intake'") },
        { base: read.base, dryRun: true }
      )
      expect(
        createTaken.diagnostics.find((finding) => finding.code === 'E_NAME_TAKEN')
      ).toMatchObject({ kind: 'workflow', key: 'copy', file: created, hint: expect.any(String) })

      const result = await apply(workspaceId, renamedTo('Ingest v2'), { base: read.base })
      expect(result.failed).toBeUndefined()
      expect(result.applied).toMatchObject([
        { kind: 'workflow', key: 'ingest', action: 'update', fields: ['name'] },
      ])
      expect((await workflows(workspaceId)).map((stored) => stored.name).sort()).toEqual([
        'Ingest v2',
        'Intake',
      ])
      const again = await get(workspaceId)
      const noop = await apply(workspaceId, again.files, { base: again.base })
      expect(noop.applied).toEqual([])
    }
  )

  check(
    'refuses at plan time two writes that leave one name twice in a folder: a rename and a create, or two renames',
    async () => {
      const workspaceId = await newWorkspace()
      await apply(workspaceId, {
        ...STARTER,
        'workflows/intake/workflow.ts': INGEST.replace("workflow('Ingest'", "workflow('Intake'"),
      })
      const read = await get(workspaceId)
      const before = (await workflows(workspaceId)).map((stored) => stored.name).sort()
      const renamed = (key: string, from: string, to: string) => {
        const entry = `workflows/${key}/workflow.ts`
        return { [entry]: read.files[entry].replace(`workflow('${from}'`, `workflow('${to}'`) }
      }

      for (const files of [
        {
          ...read.files,
          ...renamed('ingest', 'Ingest', 'Shared'),
          'workflows/shared/workflow.ts': INGEST.replace("workflow('Ingest'", "workflow('Shared'"),
        },
        {
          ...read.files,
          ...renamed('ingest', 'Ingest', 'Shared'),
          ...renamed('intake', 'Intake', 'Shared'),
        },
      ]) {
        const dryRun = await apply(workspaceId, files, { base: read.base, dryRun: true })
        expect(codes(dryRun.diagnostics)).toEqual(['E_NAME_TAKEN'])
        const refused = await refusal(apply(workspaceId, files, { base: read.base }))
        expect(codes(refused.diagnostics)).toEqual(['E_NAME_TAKEN'])
        expect((await workflows(workspaceId)).map((stored) => stored.name).sort()).toEqual(before)
      }
    }
  )

  check(
    'a table written while another table took its key reports it applied, unbound, and stops',
    async () => {
      const workspaceId = await newWorkspace()
      const other = LEADS.replace("name: 'leads'", "name: 'other'")
      const created = await apply(workspaceId, { 'tables/other.ts': other }, { kinds: ['table'] })
      expect(created.failed).toBeUndefined()
      const otherId = created.base.resources['table:other']?.id
      if (!otherId) throw new Error('The table was not created')

      // Between the plan and the key claim, the other table comes to hold the key "leads".
      const createTable = tableUseCases.createTableUseCase.execute
      const racing = vi
        .spyOn(tableUseCases.createTableUseCase, 'execute')
        .mockImplementation(async (args) => {
          const table = await createTable(args)
          await db
            .update(workspaceResourceKey)
            .set({ key: 'leads' })
            .where(
              and(
                eq(workspaceResourceKey.workspaceId, workspaceId),
                eq(workspaceResourceKey.resourceId, otherId)
              )
            )
          return table
        })
      const result = await apply(
        workspaceId,
        { ...STARTER, 'tables/other.ts': other },
        { base: created.base }
      ).finally(() => racing.mockRestore())

      const leads = (await tables(workspaceId)).find((table) => table.name === 'leads')
      expect(result.applied).toMatchObject([
        { kind: 'table', key: 'leads', action: 'create', id: leads?.id },
      ])
      expect(result.applied).toHaveLength(1)
      expect(result.failed).toMatchObject({ kind: 'table', key: 'leads', code: 'E_NAME_TAKEN' })
      expect(codes(result.diagnostics)).toEqual(['E_NAME_TAKEN'])
      expect(result.base.resources['table:leads']).toBeUndefined()
      expect(await workflows(workspaceId)).toEqual([])
    }
  )

  check(
    'a workflow create whose key claim fails leaves no workflow behind, so applying again creates it',
    async () => {
      const workspaceId = await newWorkspace()
      const files = {
        'workflows/claim-crash/workflow.ts': `// @sim-sdk 1
import { trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Claim Crash', {}, () => {
  trigger.start('Start', { inputFormat: { email: 'string' } })
})
`,
      }
      const restore = await failKeyClaims('claim-crash')
      const crashed = await apply(workspaceId, files, { kinds: ['workflow'] }).finally(restore)

      expect(crashed.failed).toMatchObject({ kind: 'workflow', key: 'claim-crash' })
      expect(crashed.applied).toEqual([])
      expect(await workflows(workspaceId)).toEqual([])

      const again = await apply(workspaceId, files, { kinds: ['workflow'] })
      expect(again.failed).toBeUndefined()
      const [created] = await workflows(workspaceId)
      expect(created?.name).toBe('Claim Crash')
      const [binding] = await db
        .select({ resourceId: workspaceResourceKey.resourceId })
        .from(workspaceResourceKey)
        .where(
          and(
            eq(workspaceResourceKey.workspaceId, workspaceId),
            eq(workspaceResourceKey.kind, 'workflow'),
            eq(workspaceResourceKey.key, 'claim-crash')
          )
        )
      expect(binding?.resourceId).toBe(created?.id)
    }
  )
  check(
    'a workflow deleted between the plan and its write stops the apply as stale, not refused',
    async () => {
      const workspaceId = await newWorkspace()
      const created = await apply(workspaceId, {
        ...STARTER,
        'workflows/other/workflow.ts': `// @sim-sdk 1
import { trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Other', {}, () => {
  trigger.start('Start', { inputFormat: { email: 'string' } })
})
`,
      })
      expect(created.failed).toBeUndefined()
      const read = await get(workspaceId)
      const entry = 'workflows/ingest/workflow.ts'
      const ingestId = read.base.resources['workflow:ingest']?.id ?? ''
      const authorize = applyWorkflowSource.authorize
      const racing = vi.spyOn(applyWorkflowSource, 'authorize').mockImplementation(async (args) => {
        const admitted = await authorize(args)
        await deleteWorkflow.execute({ principal: owner, input: { workflowId: ingestId } })
        return admitted
      })

      const result = await apply(
        workspaceId,
        {
          ...read.files,
          [entry]: read.files[entry].replace("workflow('Ingest'", "workflow('Intake'"),
        },
        { base: read.base }
      ).finally(() => racing.mockRestore())

      expect(result.failed).toMatchObject({
        kind: 'workflow',
        key: 'ingest',
        code: 'E_APPLY_STALE',
      })
      expect(codes(result.diagnostics)).toEqual(['E_APPLY_STALE'])
    }
  )
})
