/**
 * Table rows as workspace source against Postgres: seed rows written once into a new table, and
 * managed rows kept equal to `tables/<key>.rows.jsonl` through the reshape use case, by their own
 * three-way rule (stale when the server's rows moved since the base), with removals gated by
 * `--allow-delete` and a get printing them back byte for byte. Row counts and versions are the
 * migrated triggers', never set by hand.
 */
import { db } from '@sim/db'
import { user, userTableDefinitions, userTableRows } from '@sim/db/schema'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { getTableById } from '@/lib/table/service'
import type { ApplyWorkspaceSourceInput } from '@/lib/workspace-source/application/apply-workspace-source'
import { tableAdapter } from '@/lib/workspace-source/application/kinds/table/adapter'
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
  'WORKSPACE_SOURCE_ROWS_REPORT_PATH',
  'workspace-source-rows.json'
)
const workspaces = sourceWorkspaces()
const runner = sourceRunner(['table'], owner)

const PLANS = (rows: string) => `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'plans',
  columns: {
    code: column.string({ required: true, unique: true }),
    seats: column.number(),
    tier: column.select({ options: ['basic', 'pro'] }),
  },
  rows: ${rows},
})
`
const MANAGED = PLANS("{ mode: 'managed', key: 'code' }")
const SEED = PLANS("{ mode: 'seed' }")
const ROWS = '{"code":"solo","seats":1,"tier":"basic"}\n{"code":"team","seats":10,"tier":"pro"}\n'

type ApplyOptions = Partial<Omit<ApplyWorkspaceSourceInput, 'workspaceId' | 'files'>> & {
  principal?: Parameters<typeof runner.get>[1]
}

function apply(workspaceId: string, files: Record<string, string>, options: ApplyOptions = {}) {
  return runner.apply(workspaceId, { files, ...options })
}

function newWorkspace() {
  return workspaces.create({
    name: 'Rows as source',
    ownerId,
    members: [{ userId: readerId, permission: 'read' }],
  })
}

/** The workspace's one table. */
async function storedTable(workspaceId: string) {
  const [row] = await db
    .select({ id: userTableDefinitions.id })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )
  const table = row ? await getTableById(row.id) : null
  if (!table) throw new Error('The workspace has no table')
  return table
}

/** The table's rows as `{ column name: value }`, select cells by option name, sorted by code. */
async function storedRows(workspaceId: string) {
  const table = await storedTable(workspaceId)
  const rows = await db
    .select({ data: userTableRows.data })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, table.id))
  return rows
    .map(({ data }) =>
      Object.fromEntries(
        Object.entries(data as Record<string, unknown>).map(([id, value]) => {
          const column = table.schema.columns.find((candidate) => candidate.id === id)
          const option = column?.options?.find((candidate) => candidate.id === value)
          return [column?.name ?? id, option ? option.name : value]
        })
      )
    )
    .sort((a, b) => compareStrings(String(a.code), String(b.code)))
}

/** Changes one stored cell behind the directory's back, as another client's row write would. */
async function editStoredSeats(workspaceId: string, code: string, seats: number) {
  const table = await storedTable(workspaceId)
  const id = (name: string) => table.schema.columns.find((column) => column.name === name)?.id ?? ''
  await db
    .update(userTableRows)
    .set({
      data: sql`jsonb_set(${userTableRows.data}, ${`{${id('seats')}}`}, ${String(seats)}::jsonb)`,
    })
    .where(
      and(eq(userTableRows.tableId, table.id), sql`${userTableRows.data}->>${id('code')} = ${code}`)
    )
}

/** A managed `plans` table applied from scratch, then read back. */
async function managedPlans(workspaceId: string) {
  const created = await apply(workspaceId, {
    'tables/plans.ts': MANAGED,
    'tables/plans.rows.jsonl': ROWS,
  })
  expect(created.failed).toBeUndefined()
  return runner.get(workspaceId)
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values(
    [ownerId, readerId].map((id) => ({
      id,
      name: 'Rows fixture',
      email: `${id}@workspace-source-rows.invalid`,
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

describe('table rows as workspace source', () => {
  check('creates a managed table with its rows and reads them back byte for byte', async () => {
    const workspaceId = await newWorkspace()
    const read = await managedPlans(workspaceId)

    expect(await storedRows(workspaceId)).toEqual([
      { code: 'solo', seats: 1, tier: 'basic' },
      { code: 'team', seats: 10, tier: 'pro' },
    ])
    expect(read.files['tables/plans.ts']).toBe(MANAGED)
    expect(read.files['tables/plans.rows.jsonl']).toBe(ROWS)
    expect(read.base.resources['table:plans']?.rows?.fingerprint).toMatch(/^rf1:/)

    const again = await apply(workspaceId, read.files, { base: read.base })
    expect(again.applied).toEqual([])
    expect(again.files).toEqual({})
  })

  check(
    'writes an edited row and a new one, and removes a row only with allow-delete',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await managedPlans(workspaceId)
      const edited = {
        ...read.files,
        'tables/plans.rows.jsonl':
          '{"code":"solo","seats":2,"tier":"basic"}\n{"code":"team","seats":10,"tier":"pro"}\n{"code":"duo","seats":2}\n',
      }
      const planned = await apply(workspaceId, edited, { base: read.base, dryRun: true })
      expect(planned.diagnostics.filter((finding) => finding.severity === 'error')).toEqual([])
      const result = await apply(workspaceId, edited, { base: read.base })
      expect(result.applied).toMatchObject([
        { kind: 'table', key: 'plans', action: 'update', fields: ['rows (3)'] },
      ])
      expect(await storedRows(workspaceId)).toEqual([
        { code: 'duo', seats: 2 },
        { code: 'solo', seats: 2, tier: 'basic' },
        { code: 'team', seats: 10, tier: 'pro' },
      ])

      const shrunk = {
        ...edited,
        'tables/plans.rows.jsonl': '{"code":"solo","seats":2,"tier":"basic"}\n',
      }
      const refused = await refusal(apply(workspaceId, shrunk, { base: result.base }))
      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect(refused.diagnostics[0]?.message).toContain('removes 2 row(s)')
      expect(await storedRows(workspaceId)).toHaveLength(3)

      const removed = await apply(workspaceId, shrunk, {
        base: result.base,
        allowDelete: true,
      })
      expect(removed.applied).toMatchObject([
        { key: 'plans', destructive: { counts: { rows: 2 } } },
      ])
      expect(await storedRows(workspaceId)).toEqual([{ code: 'solo', seats: 2, tier: 'basic' }])
    }
  )

  check('refuses rows edited here that the server changed since the base', async () => {
    const workspaceId = await newWorkspace()
    const read = await managedPlans(workspaceId)
    await editStoredSeats(workspaceId, 'team', 99)

    // Unchanged here: the server's rows are kept, not overwritten.
    const kept = await apply(workspaceId, read.files, { base: read.base })
    expect(kept.applied).toEqual([])
    expect((await storedRows(workspaceId))[1]).toMatchObject({ code: 'team', seats: 99 })

    const edited = {
      ...read.files,
      'tables/plans.rows.jsonl': ROWS.replace('"seats":1', '"seats":3'),
    }
    const stale = await refusal(apply(workspaceId, edited, { base: read.base }))
    expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
    expect((await storedRows(workspaceId))[0]).toMatchObject({ code: 'solo', seats: 1 })

    // The directory already holding what the server changed to is not stale.
    const caughtUp = {
      ...read.files,
      'tables/plans.rows.jsonl': ROWS.replace('"seats":10', '"seats":99'),
    }
    const refreshed = await apply(workspaceId, caughtUp, { base: read.base })
    expect(refreshed.applied).toEqual([])
    expect(refreshed.base.resources['table:plans']?.rows?.fingerprint).not.toBe(
      read.base.resources['table:plans']?.rows?.fingerprint
    )
  })

  check('refuses a row write whose version moved after the plan read it', async () => {
    const workspaceId = await newWorkspace()
    const read = await managedPlans(workspaceId)
    const check = tableAdapter.fingerprintNow
    if (!check) throw new Error('The table adapter checks fingerprints before writing')
    // Another client's row write lands between the plan and the apply's pre-write check.
    const moved = vi
      .spyOn(tableAdapter, 'fingerprintNow')
      .mockImplementation(async (change, ctx) => {
        await editStoredSeats(workspaceId, 'team', 7)
        return check.call(tableAdapter, change, ctx)
      })
    try {
      const edited = {
        ...read.files,
        'tables/plans.rows.jsonl': ROWS.replace('"seats":1', '"seats":4'),
      }
      const result = await apply(workspaceId, edited, { base: read.base })
      expect([result.failed?.key, result.failed?.code, result.failed?.message]).toEqual([
        'plans',
        'E_APPLY_STALE',
        expect.any(String),
      ])
      expect(result.applied).toEqual([])
    } finally {
      moved.mockRestore()
    }
    expect(await storedRows(workspaceId)).toEqual([
      { code: 'solo', seats: 1, tier: 'basic' },
      { code: 'team', seats: 7, tier: 'pro' },
    ])
  })

  check('seeds a new table once, and only a new or empty one', async () => {
    const workspaceId = await newWorkspace()
    const files = { 'tables/plans.ts': SEED, 'tables/plans.rows.jsonl': ROWS }
    const created = await apply(workspaceId, files)
    expect(created.applied).toMatchObject([
      { key: 'plans', action: 'create', fields: expect.arrayContaining(['rows (seed 2)']) },
    ])
    expect(created.files).toEqual(files)
    expect(await storedRows(workspaceId)).toHaveLength(2)
    await editStoredSeats(workspaceId, 'solo', 5)

    const again = await apply(workspaceId, files, { base: created.base })
    expect(again.applied).toEqual([])
    expect((await storedRows(workspaceId))[0]).toMatchObject({ seats: 5 })

    // A get leaves seed rows out: they were never the table's identity.
    const read = await runner.get(workspaceId)
    expect(read.files['tables/plans.rows.jsonl']).toBeUndefined()
    expect((await apply(workspaceId, read.files, { base: read.base })).applied).toEqual([])

    // A directory without a base meets a table that holds rows: nothing is seeded.
    const adopted = await apply(workspaceId, files)
    expect(codes(adopted.diagnostics, 'info')).toContain('I_TABLE_SEED_SKIPPED')
    expect(await storedRows(workspaceId)).toHaveLength(2)
  })

  check('stops managing rows when the declaration drops them, keeping every row', async () => {
    const workspaceId = await newWorkspace()
    const read = await managedPlans(workspaceId)
    const files = {
      'tables/plans.ts': read.files['tables/plans.ts'].replace(
        "  rows: { mode: 'managed', key: 'code' },\n",
        ''
      ),
    }
    const result = await apply(workspaceId, files, { base: read.base })
    expect(result.applied).toMatchObject([
      { key: 'plans', action: 'update', fields: ['rows (no longer managed)'] },
    ])
    expect(await storedRows(workspaceId)).toHaveLength(2)
    const after = await runner.get(workspaceId)
    expect(after.files['tables/plans.rows.jsonl']).toBeUndefined()
    expect(after.files['tables/plans.ts']).toBe(files['tables/plans.ts'])
  })

  check(
    'refuses a read-only member, and a rows file the declaration does not opt into',
    async () => {
      const workspaceId = await newWorkspace()
      const denied = await apply(
        workspaceId,
        { 'tables/plans.ts': MANAGED, 'tables/plans.rows.jsonl': ROWS },
        { principal: reader }
      ).then(
        () => null,
        (caught: unknown) => caught
      )
      expect(denied).toMatchObject({ code: 'forbidden' })

      const stray = await refusal(
        apply(workspaceId, {
          'tables/plans.ts': PLANS('undefined').replace('  rows: undefined,\n', ''),
          'tables/plans.rows.jsonl': ROWS,
        })
      )
      expect(codes(stray.diagnostics)).toEqual(['E_TABLE_ROWS'])
      expect(
        await db
          .select()
          .from(userTableDefinitions)
          .where(eq(userTableDefinitions.workspaceId, workspaceId))
      ).toEqual([])
    }
  )

  check('lets a workspace API key manage rows, as the table use cases allow it', async () => {
    const workspaceId = await newWorkspace()
    const apiKey = createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() })
    const created = await apply(
      workspaceId,
      { 'tables/plans.ts': MANAGED, 'tables/plans.rows.jsonl': ROWS },
      { principal: apiKey }
    )
    expect(created.failed).toBeUndefined()
    expect(await storedRows(workspaceId)).toHaveLength(2)
  })
})
