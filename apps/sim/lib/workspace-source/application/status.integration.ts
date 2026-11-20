/**
 * `status` against Postgres: a directory read by a get, edited on either side, planned the way
 * `sim workspaces source status` sends it (the plan read, every workflow folder whole, deletes
 * allowed), and read
 * through the status module the CLI prints. Proves that what the server's plan reports is the
 * drift and the conflicts a status names, a UI edit of a workflow included.
 */
import { db } from '@sim/db'
import { user, userTableDefinitions, workflow } from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import { unchangedFiles } from '@sim/workspace-code/kinds/workflow'
import {
  changedFiles,
  localResourceChanges,
  serverResourceChanges,
  sourceStatus,
} from '@sim/workspace-code/status'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import * as tableUseCases from '@/lib/table/application/tables'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { planWorkspaceSource } from '@/lib/workspace-source/application/apply-workspace-source'
import {
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const ownerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_STATUS_REPORT_PATH',
  'workspace-source-status.json'
)
const workspaces = sourceWorkspaces()
const runner = sourceRunner(['table', 'workflow'], owner)

const LEADS = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'leads',
  columns: {
    email: column.string({ required: true }),
  },
})
`

const DEALS = LEADS.replace("name: 'leads'", "name: 'deals'")

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

/** A directory read by a get: its files and base, as `.sim/written.json` records them. */
interface ReadDirectory {
  workspaceId: string
  files: Record<string, string>
  base: unknown
}

async function readDirectory(): Promise<ReadDirectory> {
  const workspaceId = await workspaces.create({ name: 'Workspace source status', ownerId })
  const created = await runner.apply(workspaceId, {
    files: { 'tables/leads.ts': LEADS, 'workflows/ingest/workflow.ts': INGEST },
  })
  expect(created.failed).toBeUndefined()
  const read = await runner.get(workspaceId)
  return { workspaceId, files: read.files, base: read.base }
}

/**
 * The status of `local` (the directory's files now) against what the get wrote, with the dry run
 * a status sends: `whole` sends every workflow folder with its files, as the CLI's status does;
 * without it, an unchanged folder goes as its base alone, as an apply sends it.
 */
async function statusOf(read: ReadDirectory, local: Record<string, string>, whole = true) {
  const files = whole
    ? local
    : Object.fromEntries(
        Object.entries(local).filter(
          ([path]) =>
            !path.startsWith('workflows/ingest/') ||
            Object.hasOwn(
              unchangedFiles(
                'ingest',
                Object.fromEntries(
                  Object.entries(local).filter(([each]) => each.startsWith('workflows/ingest/'))
                ),
                read.workspaceId
              ),
              path
            )
        )
      )
  const plan = await withPermissionGroupScope(() =>
    planWorkspaceSource.execute({
      principal: owner,
      input: {
        workspaceId: read.workspaceId,
        kinds: ['table', 'workflow'],
        files,
        base: read.base,
        allowDelete: true,
      },
    })
  )
  expect(plan.dryRun).toBe(true)
  const changed = changedFiles(local, read.files, () => true)
  return {
    plan,
    status: sourceStatus(localResourceChanges(changed), serverResourceChanges(plan.diagnostics)),
  }
}

async function storedTable(workspaceId: string, name: string) {
  const [row] = await db
    .select({ id: userTableDefinitions.id })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        eq(userTableDefinitions.name, name),
        isNull(userTableDefinitions.archivedAt)
      )
    )
  if (!row) throw new Error(`No table ${name}`)
  return row.id
}

/** Edits the table's description, as the table settings in the UI do. */
async function editTableInUi(workspaceId: string) {
  await tableUseCases.updateTableUseCase.execute({
    principal: owner,
    input: {
      tableId: await storedTable(workspaceId, 'leads'),
      workspaceId,
      description: 'UI edit',
    },
  })
}

/** Adds a start input to the stored workflow, as an edit in the editor does. */
async function editWorkflowInUi(workspaceId: string) {
  const [stored] = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
  await withPermissionGroupScope(async () => {
    const source = await readWorkflowSource.execute({
      principal: owner,
      input: { workflowId: stored.id },
    })
    const edited = await applyWorkflowSource.execute({
      principal: owner,
      input: {
        workflowId: stored.id,
        files: {
          ...source.files,
          'workflow.ts': source.files['workflow.ts'].replace(
            "{ email: 'string' }",
            "{ email: 'string', name: 'string' }"
          ),
        },
        lock: source.lock,
        base: source.base,
      },
    })
    expect(edited.applied).toBe(true)
  })
}

const editedLeads = (read: ReadDirectory) => ({
  ...read.files,
  'tables/leads.ts': read.files['tables/leads.ts'].replace(
    'email: column.string({ required: true }),',
    'email: column.string({ required: true }),\n    status: column.string(),'
  ),
})

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Workspace source status fixture',
    email: `${ownerId}@workspace-source.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await writeReport()
  await workspaces.cleanup()
  await db.delete(user).where(inArray(user.id, [ownerId]))
})

describe('workspace source status', () => {
  check('a directory nobody changed is clean', async () => {
    const read = await readDirectory()

    const { status } = await statusOf(read, read.files)

    expect(status).toEqual({ state: 'clean', local: [], drift: [], conflicts: [] })
  })

  check('a local edit alone is a local change the dry run plans as an update', async () => {
    const read = await readDirectory()

    const { status, plan } = await statusOf(read, editedLeads(read))

    expect(status.state).toBe('local')
    expect(status.local).toEqual([
      {
        kind: 'table',
        key: 'leads',
        change: 'edited',
        files: [{ path: 'tables/leads.ts', change: 'edited' }],
      },
    ])
    expect(plan.plan).toContainEqual(expect.objectContaining({ key: 'leads', action: 'update' }))
  })

  check('a table edited in the UI after the get is drift', async () => {
    const read = await readDirectory()
    await editTableInUi(read.workspaceId)

    const { status } = await statusOf(read, read.files)

    expect(status).toEqual({
      state: 'drift',
      local: [],
      drift: [{ kind: 'table', key: 'leads', server: 'changed' }],
      conflicts: [],
    })
  })

  check(
    'a workflow edited in the UI after the get is drift, which only a whole folder reveals',
    async () => {
      const read = await readDirectory()
      await editWorkflowInUi(read.workspaceId)

      const whole = await statusOf(read, read.files)
      const trimmed = await statusOf(read, read.files, false)

      expect(whole.status).toEqual({
        state: 'drift',
        local: [],
        drift: [{ kind: 'workflow', key: 'ingest', server: 'changed' }],
        conflicts: [],
      })
      expect(trimmed.status.state).toBe('clean')
    }
  )

  check('a resource added on the server after the get is drift', async () => {
    const read = await readDirectory()
    const added = await runner.apply(read.workspaceId, {
      files: { 'tables/deals.ts': DEALS },
      kinds: ['table'],
      only: ['table'],
    })
    expect(added.failed).toBeUndefined()

    const { status } = await statusOf(read, read.files)

    expect(status.drift).toEqual([{ kind: 'table', key: 'deals', server: 'added' }])
  })

  check('a table edited on both sides is a conflict', async () => {
    const read = await readDirectory()
    await editTableInUi(read.workspaceId)

    const { status } = await statusOf(read, editedLeads(read))

    expect(status).toMatchObject({
      state: 'conflict',
      drift: [],
      conflicts: [{ kind: 'table', key: 'leads', server: 'changed', change: 'edited' }],
    })
  })

  check('a deleted table the server changed since is a conflict, not a delete', async () => {
    const read = await readDirectory()
    await editTableInUi(read.workspaceId)
    const rest = Object.fromEntries(
      Object.entries(read.files).filter(([path]) => path !== 'tables/leads.ts')
    )

    const { status, plan } = await statusOf(read, rest)

    expect(status.conflicts).toEqual([
      { kind: 'table', key: 'leads', server: 'changed', change: 'deleted' },
    ])
    expect(plan.plan).not.toContainEqual(expect.objectContaining({ action: 'delete' }))
  })
})
