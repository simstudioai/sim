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
import { tableTriggerMock, tableTriggerMockFns } from '@sim/testing/mocks/table-trigger.mock'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { updateTableColumnUseCase } from '@/lib/table/application/columns'
import { createTableRows } from '@/lib/table/application/rows'
import { createTableUseCase } from '@/lib/table/application/tables'
import { readCurrentRowsVersion } from '@/lib/table/row-changes'
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
// The trigger module is mocked so each check sees exactly which row events an apply fires.
vi.mock('@/lib/table/trigger', () => tableTriggerMock)
/** A row limit a check sets for the table plan (billing is off here, so it is otherwise unlimited). */
const planRowLimit = vi.hoisted(() => ({ value: undefined as number | undefined }))
vi.mock('@/lib/table/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table/constants')>()
  return {
    ...actual,
    getBillingDisabledTableLimits: () => {
      const limits = actual.getBillingDisabledTableLimits()
      return planRowLimit.value === undefined
        ? limits
        : { ...limits, maxRowsPerTable: planRowLimit.value }
    },
  }
})

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

/** Each stored row's id and update time, by its `code`. */
async function rowIdentities(workspaceId: string) {
  const table = await storedTable(workspaceId)
  const codeId = table.schema.columns.find((column) => column.name === 'code')?.id ?? ''
  const rows = await db
    .select({ id: userTableRows.id, data: userTableRows.data, updatedAt: userTableRows.updatedAt })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, table.id))
  return Object.fromEntries(
    rows.map((row) => [
      String((row.data as Record<string, unknown>)[codeId]),
      { id: row.id, updatedAt: row.updatedAt.getTime() },
    ])
  )
}

/** The table's live row version, which every row write moves. */
async function version(workspaceId: string) {
  return (await readCurrentRowsVersion((await storedTable(workspaceId)).id)) ?? -1
}

/** The row events the table trigger was fired with since the last reset: event and row count. */
function firedEvents() {
  return tableTriggerMockFns.mockFireTableTrigger.mock.calls.map((call) => [
    call[3],
    (call[4] as unknown[]).length,
  ])
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

/** Adds a row as the table grid's "add row" does: the cells given by column name, the rest empty. */
async function addUiRow(workspaceId: string, data: Record<string, string | number>) {
  const table = await storedTable(workspaceId)
  await createTableRows.execute({
    principal: owner,
    input: {
      tableId: table.id,
      assertedWorkspaceId: workspaceId,
      strictWrite: false,
      dataKeying: 'names',
      kind: 'single',
      data,
    },
  })
}

/** Adds keyed rows until the table's managed rows print past `maxRowsBytes`. */
async function growPastRowsBytes(workspaceId: string) {
  const filler = 'x'.repeat(370_000)
  const rows = Math.ceil(WORKSPACE_SOURCE_LIMITS.maxRowsBytes / filler.length) + 1
  for (let index = 0; index < rows; index++) {
    await addUiRow(workspaceId, { code: `big${index}-${filler}`, seats: index })
  }
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

  check('writes only the row whose declared cells changed, keeping every row id', async () => {
    const workspaceId = await newWorkspace()
    const three = `${ROWS}{"code":"duo","seats":2}\n`
    const created = await apply(workspaceId, {
      'tables/plans.ts': MANAGED,
      'tables/plans.rows.jsonl': three,
    })
    expect(created.failed).toBeUndefined()
    const before = await rowIdentities(workspaceId)
    const versionBefore = await version(workspaceId)
    tableTriggerMockFns.mockFireTableTrigger.mockClear()

    const result = await apply(
      workspaceId,
      { ...created.files, 'tables/plans.rows.jsonl': three.replace('"seats":1', '"seats":3') },
      { base: created.base }
    )

    expect(result.failed).toBeUndefined()
    const after = await rowIdentities(workspaceId)
    expect(Object.keys(after).sort()).toEqual(['duo', 'solo', 'team'])
    for (const code of ['duo', 'team']) expect(after[code]).toEqual(before[code])
    expect(after.solo.id).toBe(before.solo.id)
    expect(after.solo.updatedAt).toBeGreaterThan(before.solo.updatedAt)
    expect(firedEvents()).toEqual([['update', 1]])
    expect(await version(workspaceId)).toBe(versionBefore + 1)
    expect((await storedRows(workspaceId))[1]).toMatchObject({ code: 'solo', seats: 3 })
  })

  check("swaps two managed rows' values in a unique column that is not the key", async () => {
    const workspaceId = await newWorkspace()
    const withEmail = MANAGED.replace(
      "    tier: column.select({ options: ['basic', 'pro'] }),\n",
      "    tier: column.select({ options: ['basic', 'pro'] }),\n    email: column.string({ unique: true }),\n"
    )
    const rows = (solo: string, team: string) =>
      `{"code":"solo","email":"${solo}"}\n{"code":"team","email":"${team}"}\n`
    const created = await apply(workspaceId, {
      'tables/plans.ts': withEmail,
      'tables/plans.rows.jsonl': rows('solo@example.test', 'team@example.test'),
    })
    expect(created.failed).toBeUndefined()
    const before = await rowIdentities(workspaceId)

    const swapped = await apply(
      workspaceId,
      {
        ...created.files,
        'tables/plans.rows.jsonl': rows('team@example.test', 'solo@example.test'),
      },
      { base: created.base }
    )

    expect(swapped.failed).toBeUndefined()
    expect(await storedRows(workspaceId)).toEqual([
      { code: 'solo', email: 'team@example.test' },
      { code: 'team', email: 'solo@example.test' },
    ])
    const after = await rowIdentities(workspaceId)
    expect([after.solo.id, after.team.id]).toEqual([before.solo.id, before.team.id])
  })

  check('a no-op reapply writes nothing, with or without the base', async () => {
    const workspaceId = await newWorkspace()
    const read = await managedPlans(workspaceId)
    const before = await rowIdentities(workspaceId)
    const versionBefore = await version(workspaceId)
    tableTriggerMockFns.mockFireTableTrigger.mockClear()

    expect((await apply(workspaceId, read.files, { base: read.base })).applied).toEqual([])
    expect((await apply(workspaceId, read.files)).applied).toEqual([])

    expect(await rowIdentities(workspaceId)).toEqual(before)
    expect(await version(workspaceId)).toBe(versionBefore)
    expect(firedEvents()).toEqual([])
  })

  check(
    "a column's key survives a fresh get and a rename in Sim, and a table written before keys were recorded records them",
    async () => {
      const workspaceId = await newWorkspace()
      const keyed = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'keyed',
  columns: {
    sku: column.string({ required: true, unique: true }),
    note: column.string({ name: 'note_text' }),
  },
})
`
      const created = await apply(workspaceId, { 'tables/keyed.ts': keyed })
      expect(created.failed).toBeUndefined()
      expect((await runner.get(workspaceId)).files['tables/keyed.ts']).toContain(
        "note: column.string({ name: 'note_text' })"
      )

      const [table] = await db
        .select({ id: userTableDefinitions.id, metadata: userTableDefinitions.metadata })
        .from(userTableDefinitions)
        .where(
          and(
            eq(userTableDefinitions.workspaceId, workspaceId),
            isNull(userTableDefinitions.archivedAt)
          )
        )
      await updateTableColumnUseCase.execute({
        principal: owner,
        input: {
          tableId: table.id,
          workspaceId,
          columnName: 'note_text',
          updates: { name: 'memo' },
        },
      })
      expect((await runner.get(workspaceId)).files['tables/keyed.ts']).toContain(
        "note: column.string({ name: 'memo' })"
      )

      await db
        .update(userTableDefinitions)
        .set({ metadata: {} })
        .where(eq(userTableDefinitions.id, table.id))
      const legacy = await runner.get(workspaceId)
      expect(legacy.files['tables/keyed.ts']).toContain('memo: column.string()')
      const recorded = await apply(
        workspaceId,
        { 'tables/keyed.ts': keyed.replace("name: 'note_text'", "name: 'memo'") },
        { base: legacy.base }
      )
      expect(recorded.applied).toMatchObject([
        { kind: 'table', key: 'keyed', action: 'update', fields: ['column keys'] },
      ])
      expect((await runner.get(workspaceId)).files['tables/keyed.ts']).toContain(
        "note: column.string({ name: 'memo' })"
      )
    }
  )

  check(
    'managed rows resent against a fresh read plan as no change, a column keyed apart from its name included, as a promotion resends them',
    async () => {
      const workspaceId = await newWorkspace()
      const typed = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'typed',
  columns: {
    sku: column.string({ required: true, unique: true }),
    shipped: column.date(),
    expires: column.ttl(),
    price: column.currency({ currencyCode: 'EUR' }),
    labels: column.select({ options: ['red', 'green', 'blue'], multiple: true }),
    status: column.select({ options: ['new', 'won'] }),
    meta: column.json(),
    note_text: column.string({ name: 'memo' }),
  },
  rows: { mode: 'managed', key: 'sku' },
})
`
      const directory = {
        'tables/typed.ts': typed,
        'tables/typed.rows.jsonl': [
          '{"sku":"A-1","shipped":"2026-11-02T10:30:00Z","expires":"2027-01-01T00:00:00-00:00","price":19.99,"labels":["red","blue"],"status":"new","meta":{"a":[1,{"b":null}]}}',
          '{"sku":"A-2","shipped":"2026-11-01","labels":[],"status":"won","meta":[1,"x",true]}',
          '{"sku":"A-9","note_text":"line1\\nline2"}',
        ].join('\n'),
      }
      const created = await apply(workspaceId, directory)
      expect(created.failed).toBeUndefined()
      const versionBefore = await version(workspaceId)
      const read = await runner.get(workspaceId)
      expect(read.files['tables/typed.rows.jsonl']).not.toBe(directory['tables/typed.rows.jsonl'])

      const resent = await apply(workspaceId, directory, { base: read.base })

      expect(resent.applied).toEqual([])
      expect(await version(workspaceId)).toBe(versionBefore)
    }
  )

  check('a key rename is a delete and an insert, gated by allow-delete', async () => {
    const workspaceId = await newWorkspace()
    const read = await managedPlans(workspaceId)
    const before = await rowIdentities(workspaceId)
    const renamed = {
      ...read.files,
      'tables/plans.rows.jsonl': ROWS.replace('"code":"solo"', '"code":"single"'),
    }

    const refused = await refusal(apply(workspaceId, renamed, { base: read.base }))
    expect(codes(refused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
    expect(await rowIdentities(workspaceId)).toEqual(before)

    tableTriggerMockFns.mockFireTableTrigger.mockClear()
    const result = await apply(workspaceId, renamed, { base: read.base, allowDelete: true })
    expect(result.failed).toBeUndefined()
    const after = await rowIdentities(workspaceId)
    expect(Object.keys(after).sort()).toEqual(['single', 'team'])
    expect(after.team).toEqual(before.team)
    expect(after.single.id).not.toBe(before.solo.id)
    expect(firedEvents()).toEqual([
      ['delete', 1],
      ['insert', 1],
    ])
  })

  check('a number key written as text matches its stored row, removing nothing', async () => {
    const workspaceId = await newWorkspace()
    const numbered = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'plans',
  columns: {
    code: column.number({ required: true, unique: true }),
    seats: column.number(),
  },
  rows: { mode: 'managed', key: 'code' },
})
`
    const created = await apply(workspaceId, {
      'tables/plans.ts': numbered,
      'tables/plans.rows.jsonl': '{"code":7,"seats":1}\n',
    })
    expect(created.failed).toBeUndefined()
    const before = await rowIdentities(workspaceId)

    const result = await apply(
      workspaceId,
      { ...created.files, 'tables/plans.rows.jsonl': '{"code":"007","seats":2}\n' },
      { base: created.base }
    )

    expect(result.failed).toBeUndefined()
    expect(result.applied).toMatchObject([{ key: 'plans', action: 'update' }])
    expect(result.applied[0]).not.toHaveProperty('destructive')
    expect(await storedRows(workspaceId)).toEqual([{ code: 7, seats: 2 }])
    expect((await rowIdentities(workspaceId))['7']?.id).toBe(before['7']?.id)
  })

  check('adds a required column and the values that fill it in one apply', async () => {
    const workspaceId = await newWorkspace()
    const read = await managedPlans(workspaceId)
    const files = {
      'tables/plans.ts': read.files['tables/plans.ts'].replace(
        '    seats: column.number(),',
        '    seats: column.number(),\n    owner: column.string({ required: true }),'
      ),
      'tables/plans.rows.jsonl':
        '{"code":"solo","seats":1,"owner":"ana","tier":"basic"}\n{"code":"team","seats":10,"owner":"bo","tier":"pro"}\n',
    }
    const before = await rowIdentities(workspaceId)

    const result = await apply(workspaceId, files, { base: read.base })

    expect(result.failed).toBeUndefined()
    const table = await storedTable(workspaceId)
    expect(table.schema.columns.find((column) => column.name === 'owner')?.required).toBe(true)
    expect((await storedRows(workspaceId)).map((row) => row.owner)).toEqual(['ana', 'bo'])
    const after = await rowIdentities(workspaceId)
    expect([after.solo.id, after.team.id]).toEqual([before.solo.id, before.team.id])

    // A row the file leaves without a value still refuses the required column.
    const unfilled = {
      'tables/plans.ts': files['tables/plans.ts'].replace('owner:', 'manager:'),
      'tables/plans.rows.jsonl': files['tables/plans.rows.jsonl']
        .replace('"owner":"ana"', '"manager":"ana"')
        .replace(',"owner":"bo"', ''),
    }
    const refused = await refusal(apply(workspaceId, unfilled, { base: result.base }))
    expect(codes(refused.diagnostics)).toContain('E_APPLY_REFUSED')
  })

  check(
    'reports managed rows the server wrote since the base as drift, and keeps them',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await managedPlans(workspaceId)
      const clean = await apply(workspaceId, read.files, { base: read.base, dryRun: true })
      expect(codes(clean.diagnostics, 'warning')).toEqual([])

      await editStoredSeats(workspaceId, 'team', 25)
      const drifted = await apply(workspaceId, read.files, { base: read.base })

      expect(drifted.applied).toEqual([])
      expect(
        drifted.diagnostics
          .filter((finding) => finding.severity === 'warning')
          .map((finding) => `${finding.code} ${finding.kind}:${finding.key}`)
      ).toEqual(['W_SERVER_CHANGED table:plans'])
      expect((await storedRows(workspaceId))[1]).toMatchObject({ code: 'team', seats: 25 })
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

  check(
    'refuses deleting a managed table whose rows the server changed since the base, even with --allow-delete',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await managedPlans(workspaceId)
      await editStoredSeats(workspaceId, 'team', 99)

      const stale = await refusal(apply(workspaceId, {}, { base: read.base, allowDelete: true }))
      expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect((await storedRows(workspaceId))[1]).toMatchObject({ code: 'team', seats: 99 })

      // Read again, the delete goes ahead.
      const fresh = await runner.get(workspaceId)
      const deleted = await apply(workspaceId, {}, { base: fresh.base, allowDelete: true })
      expect(deleted.applied).toMatchObject([{ kind: 'table', key: 'plans', action: 'delete' }])
    }
  )

  check(
    'refuses a row edit whose column the server renamed since the base, rather than dropping its cells',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await managedPlans(workspaceId)
      const table = await storedTable(workspaceId)
      await db
        .update(userTableDefinitions)
        .set({
          schema: {
            ...table.schema,
            columns: table.schema.columns.map((column) =>
              column.name === 'seats' ? { ...column, name: 'licenses' } : column
            ),
          },
        })
        .where(eq(userTableDefinitions.id, table.id))

      const edited = {
        ...read.files,
        'tables/plans.rows.jsonl': ROWS.replace('"seats":1', '"seats":3'),
      }
      const stale = await refusal(apply(workspaceId, edited, { base: read.base }))
      expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect((await storedRows(workspaceId))[0]).toMatchObject({ code: 'solo', licenses: 1 })
    }
  )

  check('refuses a row write whose version moved after the plan read it', async () => {
    const workspaceId = await newWorkspace()
    const read = await managedPlans(workspaceId)
    const check = tableAdapter.storedFingerprintNow
    if (!check) throw new Error('The table adapter checks fingerprints before writing')
    // Another client's row write lands between the plan and the apply's pre-write check.
    const moved = vi
      .spyOn(tableAdapter, 'storedFingerprintNow')
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

  check('refuses a row write whose version moved after the check, under the lock', async () => {
    const workspaceId = await newWorkspace()
    const read = await managedPlans(workspaceId)
    const check = tableAdapter.storedFingerprintNow
    if (!check) throw new Error('The table adapter checks fingerprints before writing')
    // The pre-write check passes, then a teammate's row edit commits before the reshape locks.
    const moved = vi
      .spyOn(tableAdapter, 'storedFingerprintNow')
      .mockImplementation(async (change, ctx) => {
        const fingerprint = await check.call(tableAdapter, change, ctx)
        await editStoredSeats(workspaceId, 'team', 7)
        return fingerprint
      })
    try {
      const edited = {
        ...read.files,
        'tables/plans.rows.jsonl': ROWS.replace('"seats":1', '"seats":4'),
      }
      const result = await apply(workspaceId, edited, { base: read.base, allowDelete: true })
      expect(moved).toHaveBeenCalledOnce()
      expect([result.failed?.key, result.failed?.code]).toEqual(['plans', 'E_APPLY_STALE'])
      expect(result.applied).toEqual([])
    } finally {
      moved.mockRestore()
    }
    expect(await storedRows(workspaceId)).toEqual([
      { code: 'solo', seats: 1, tier: 'basic' },
      { code: 'team', seats: 7, tier: 'pro' },
    ])
  })

  check('refuses rows the declared columns cannot hold at plan time, writing nothing', async () => {
    const workspaceId = await newWorkspace()
    const seeded = {
      'tables/plans.ts': SEED,
      'tables/plans.rows.jsonl': [
        '{}',
        '{"code":"solo","seats":"many"}',
        '{"code":"team","tier":"gold"}',
        '{"code":"solo"}',
        '',
      ].join('\n'),
    }
    const dryRun = await apply(workspaceId, seeded, { dryRun: true })
    expect(codes(dryRun.diagnostics)).toEqual(['E_TABLE_ROWS'])
    const [seedFinding] = dryRun.diagnostics
    expect(seedFinding.message).toMatch(/^4 row\(s\) of tables\/plans\.rows\.jsonl/)
    expect(seedFinding.message).toContain('row 1: Missing required field: code')
    expect(seedFinding.message).toMatch(/row 4: [^;]*must be unique/)
    const refused = await refusal(apply(workspaceId, seeded))
    expect(codes(refused.diagnostics)).toEqual(['E_TABLE_ROWS'])
    const tables = await db
      .select({ id: userTableDefinitions.id })
      .from(userTableDefinitions)
      .where(eq(userTableDefinitions.workspaceId, workspaceId))
    expect(tables).toEqual([])

    const managed = await newWorkspace()
    const read = await managedPlans(managed)
    const edited = {
      ...read.files,
      'tables/plans.rows.jsonl': ROWS.replace('"tier":"pro"', '"tier":"gold"'),
    }
    const managedDryRun = await apply(managed, edited, { base: read.base, dryRun: true })
    expect(codes(managedDryRun.diagnostics)).toEqual(['E_TABLE_ROWS'])
    expect(codes((await refusal(apply(managed, edited, { base: read.base }))).diagnostics)).toEqual(
      ['E_TABLE_ROWS']
    )
    expect(await storedRows(managed)).toEqual([
      { code: 'solo', seats: 1, tier: 'basic' },
      { code: 'team', seats: 10, tier: 'pro' },
    ])
  })

  check(
    'refuses adopting a table the directory never read when it would drop its columns or rows, even with --allow-delete',
    async () => {
      const workspaceId = await newWorkspace()
      await createTableUseCase.execute({
        principal: owner,
        input: {
          workspaceId,
          name: 'plans',
          schema: {
            columns: [
              { name: 'code', type: 'string', required: true, unique: true },
              { name: 'seats', type: 'number' },
              { name: 'notes', type: 'string' },
            ],
          },
        },
      })
      for (const code of ['solo', 'team', 'ent']) await addUiRow(workspaceId, { code, notes: code })
      const columnsBefore = (await storedTable(workspaceId)).schema.columns
      const rowsBefore = await storedRows(workspaceId)

      const refused = await refusal(
        apply(
          workspaceId,
          { 'tables/plans.ts': MANAGED, 'tables/plans.rows.jsonl': ROWS },
          { allowDelete: true }
        )
      )

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_NO_BASE'])
      expect(
        refused.diagnostics.find((finding) => finding.code === 'E_APPLY_NO_BASE')?.message
      ).toContain('columns.notes (drop)')
      expect((await storedTable(workspaceId)).schema.columns).toEqual(columnsBefore)
      expect(await storedRows(workspaceId)).toEqual(rowsBefore)
    }
  )

  check(
    'creates a managed table holding the most rows a directory may declare, in one apply',
    async () => {
      const workspaceId = await newWorkspace()
      const count = WORKSPACE_SOURCE_LIMITS.maxTableRows
      const rows = Array.from(
        { length: count },
        (_, index) => `{"code":"c${index}","seats":${index},"tier":"basic"}\n`
      ).join('')

      const created = await apply(workspaceId, {
        'tables/plans.ts': MANAGED,
        'tables/plans.rows.jsonl': rows,
      })

      expect(created.failed).toBeUndefined()
      expect((await storedTable(workspaceId)).rowCount).toBe(count)
    }
  )

  check('skips a table whose managed rows pass the rows byte limit, naming the table', async () => {
    const workspaceId = await newWorkspace()
    await managedPlans(workspaceId)
    await growPastRowsBytes(workspaceId)

    const read = await runner.get(workspaceId)

    expect(read.files['tables/plans.rows.jsonl']).toBeUndefined()
    expect(read.skipped).toEqual([
      {
        kind: 'table',
        key: 'plans',
        reason: expect.stringContaining(
          `rows of table "plans" pass the ${WORKSPACE_SOURCE_LIMITS.maxRowsBytes}-byte`
        ),
      },
    ])
  })

  check(
    'saves a table edit whose managed rows grew past the rows byte limit, keeping the rows file as sent',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await managedPlans(workspaceId)
      await growPastRowsBytes(workspaceId)
      const described = {
        ...read.files,
        'tables/plans.ts': MANAGED.replace(
          "name: 'plans',",
          "name: 'plans',\n  description: 'Seats',"
        ),
      }

      const saved = await apply(workspaceId, described, { base: read.base })

      expect(saved.failed).toBeUndefined()
      expect(saved.applied).toMatchObject([{ kind: 'table', key: 'plans', action: 'update' }])
      expect((await storedTable(workspaceId)).description).toBe('Seats')
      expect(saved.files).toEqual(described)
      const entry = saved.base.resources['table:plans']
      expect(entry?.fingerprint).not.toBe(read.base.resources['table:plans']?.fingerprint)
      expect(entry?.rows).toEqual(read.base.resources['table:plans']?.rows)
      expect(
        saved.diagnostics
          .filter((finding) => finding.code === 'W_SERVER_CHANGED')
          .map((finding) => finding.message)
      ).toContainEqual(
        expect.stringContaining(
          `rows of table "plans" pass the ${WORKSPACE_SOURCE_LIMITS.maxRowsBytes}-byte`
        )
      )

      // The saved base applies again as a no-op, keeping the server's rows.
      const again = await apply(workspaceId, saved.files, { base: saved.base })
      expect(again.failed).toBeUndefined()
      expect(again.applied).toEqual([])
      expect(codes(again.diagnostics, 'warning')).toEqual(['W_SERVER_CHANGED'])
    }
  )

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

    // A get keeps the declaration of seed rows but leaves the rows out: the directory holds them,
    // and they were never the table's identity.
    const read = await runner.get(workspaceId)
    expect(read.files['tables/plans.ts']).toContain("rows: { mode: 'seed' }")
    expect(read.files['tables/plans.rows.jsonl']).toBeUndefined()
    expect((await apply(workspaceId, read.files, { base: read.base })).applied).toEqual([])

    // A directory without a base meets a table that holds rows: nothing is seeded.
    const adopted = await apply(workspaceId, files)
    expect(codes(adopted.diagnostics, 'info')).toContain('I_TABLE_SEED_SKIPPED')
    expect(await storedRows(workspaceId)).toHaveLength(2)
  })

  check(
    'a declaration that stops seeding rows clears it, and one that starts records it',
    async () => {
      const workspaceId = await newWorkspace()
      const seeded = await apply(workspaceId, {
        'tables/plans.ts': SEED,
        'tables/plans.rows.jsonl': ROWS,
      })
      const unseeded = PLANS('undefined').replace('  rows: undefined,\n', '')

      const dropped = await apply(
        workspaceId,
        { 'tables/plans.ts': unseeded },
        { base: seeded.base }
      )
      expect(dropped.applied).toMatchObject([
        { key: 'plans', action: 'update', fields: ['rows (no longer seeded)'] },
      ])
      expect((await runner.get(workspaceId)).files['tables/plans.ts']).not.toContain('rows:')

      const read = await runner.get(workspaceId)
      const again = await apply(
        workspaceId,
        { 'tables/plans.ts': SEED, 'tables/plans.rows.jsonl': ROWS },
        { base: read.base }
      )
      expect(again.applied).toMatchObject([
        { key: 'plans', action: 'update', fields: ['rows (seed)'] },
      ])
      expect(codes(again.diagnostics, 'info')).not.toContain('I_TABLE_SEED_SKIPPED')
      expect((await runner.get(workspaceId)).files['tables/plans.ts']).toContain(
        "rows: { mode: 'seed' }"
      )
      expect(await storedRows(workspaceId)).toHaveLength(2)
    }
  )

  check('makes an existing column required in the apply whose managed rows fill it', async () => {
    const workspaceId = await newWorkspace()
    const gappy = '{"code":"solo","seats":1,"tier":"basic"}\n{"code":"team","tier":"pro"}\n'
    const created = await apply(workspaceId, {
      'tables/plans.ts': MANAGED,
      'tables/plans.rows.jsonl': gappy,
    })
    expect(created.failed).toBeUndefined()
    const read = await runner.get(workspaceId)
    const required = {
      ...read.files,
      'tables/plans.ts': read.files['tables/plans.ts'].replace(
        'seats: column.number()',
        'seats: column.number({ required: true })'
      ),
    }

    // Rows that leave a cell empty cannot make it required.
    const refused = await refusal(apply(workspaceId, required, { base: read.base }))
    expect(codes(refused.diagnostics)).toEqual(['E_APPLY_REFUSED'])
    expect(refused.diagnostics[0].message).toContain('"seats" cannot become required')

    const result = await apply(
      workspaceId,
      { ...required, 'tables/plans.rows.jsonl': ROWS },
      { base: read.base }
    )

    expect(result.failed).toBeUndefined()
    expect(await storedRows(workspaceId)).toEqual([
      { code: 'solo', seats: 1, tier: 'basic' },
      { code: 'team', seats: 10, tier: 'pro' },
    ])
    const seats = (await storedTable(workspaceId)).schema.columns.find(
      (column) => column.name === 'seats'
    )
    expect(seats?.required).toBe(true)
  })

  check('refuses seeding a table that gained a row after the plan saw it empty', async () => {
    const workspaceId = await newWorkspace()
    const bare = PLANS('undefined').replace('  rows: undefined,\n', '')
    expect((await apply(workspaceId, { 'tables/plans.ts': bare })).failed).toBeUndefined()
    const write = tableAdapter.apply.bind(tableAdapter)
    vi.spyOn(tableAdapter, 'apply').mockImplementationOnce(async (change, ctx) => {
      // A row added in the UI between this apply's plan and its write.
      const table = await storedTable(workspaceId)
      const codeId = table.schema.columns.find((column) => column.name === 'code')?.id ?? ''
      await db.insert(userTableRows).values({
        id: generateId(),
        tableId: table.id,
        workspaceId,
        data: { [codeId]: 'ui' },
        position: 0,
      })
      return write(change, ctx)
    })

    const result = await apply(workspaceId, {
      'tables/plans.ts': SEED,
      'tables/plans.rows.jsonl': ROWS,
    })

    expect(result.failed).toMatchObject({ kind: 'table', key: 'plans', code: 'E_APPLY_STALE' })
    expect(await storedRows(workspaceId)).toEqual([{ code: 'ui' }])
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

  check(
    'leaves a row the UI added without a key out of the rows file, so the get applies back unchanged and the row is kept',
    async () => {
      const workspaceId = await newWorkspace()
      const optionalKey = MANAGED.replace(
        'column.string({ required: true, unique: true })',
        'column.string({ unique: true })'
      )
      const created = await apply(workspaceId, {
        'tables/plans.ts': optionalKey,
        'tables/plans.rows.jsonl': ROWS,
      })
      expect(created.failed).toBeUndefined()
      await addUiRow(workspaceId, {})

      const read = await runner.get(workspaceId)
      expect(read.files['tables/plans.rows.jsonl']).toBe(ROWS)
      expect(codes(read.diagnostics, 'info')).toEqual(['I_TABLE_ROWS_UNKEYED'])

      const again = await apply(workspaceId, read.files, { base: read.base })
      expect(codes(again.diagnostics)).toEqual([])
      expect(again.applied).toEqual([])
      expect(await storedRows(workspaceId)).toHaveLength(3)

      // A rows write leaves it alone, even with --allow-delete, and counts it as no removal.
      const edited = {
        ...read.files,
        'tables/plans.rows.jsonl': ROWS.replace('"seats":1', '"seats":2'),
      }
      const written = await apply(workspaceId, edited, { base: read.base, allowDelete: true })
      expect(written.failed).toBeUndefined()
      expect(written.applied[0]).not.toHaveProperty('destructive')
      expect(await storedRows(workspaceId)).toEqual([
        { code: 'solo', seats: 2, tier: 'basic' },
        { code: 'team', seats: 10, tier: 'pro' },
        {},
      ])

      // Its empty cells still refuse a column made required, at plan time.
      const required = {
        'tables/plans.ts': read.files['tables/plans.ts'].replace(
          'seats: column.number()',
          'seats: column.number({ required: true })'
        ),
        'tables/plans.rows.jsonl': ROWS,
      }
      const refused = await refusal(apply(workspaceId, required, { base: written.base }))
      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_REFUSED'])
    }
  )

  check(
    'refuses a managed write whose rows, with the rows the UI added without a key that it keeps, would cross the row limit',
    async () => {
      const workspaceId = await newWorkspace()
      const optionalKey = MANAGED.replace(
        'column.string({ required: true, unique: true })',
        'column.string({ unique: true })'
      )
      const created = await apply(workspaceId, {
        'tables/plans.ts': optionalKey,
        'tables/plans.rows.jsonl': ROWS,
      })
      expect(created.failed).toBeUndefined()
      await addUiRow(workspaceId, {})
      await addUiRow(workspaceId, {})
      const read = await runner.get(workspaceId)
      const rowsBefore = await storedRows(workspaceId)
      planRowLimit.value = 4
      try {
        const written = await apply(
          workspaceId,
          {
            ...read.files,
            'tables/plans.rows.jsonl': `${ROWS}{"code":"ent","seats":50,"tier":"pro"}\n`,
          },
          { base: read.base }
        )
        expect(written.failed?.message).toContain('row limit (4 rows)')
      } finally {
        planRowLimit.value = undefined
      }
      expect(await storedRows(workspaceId)).toEqual(rowsBefore)
    }
  )

  check(
    'still applies a managed write that adds no rows to a table already over its row limit',
    async () => {
      const workspaceId = await newWorkspace()
      const optionalKey = MANAGED.replace(
        'column.string({ required: true, unique: true })',
        'column.string({ unique: true })'
      )
      const created = await apply(workspaceId, {
        'tables/plans.ts': optionalKey,
        'tables/plans.rows.jsonl': ROWS,
      })
      expect(created.failed).toBeUndefined()
      await addUiRow(workspaceId, {})
      await addUiRow(workspaceId, {})
      const read = await runner.get(workspaceId)
      planRowLimit.value = 3
      try {
        const written = await apply(
          workspaceId,
          {
            ...read.files,
            'tables/plans.rows.jsonl': ROWS.replace('"seats":10', '"seats":12'),
          },
          { base: read.base }
        )
        expect(written.failed).toBeUndefined()
      } finally {
        planRowLimit.value = undefined
      }
      expect((await storedRows(workspaceId)).map((row) => row.seats)).toContain(12)
    }
  )

  check(
    'edits and shrinks a managed table whose declared rows alone already pass its row limit, as after a plan downgrade',
    async () => {
      const workspaceId = await newWorkspace()
      const three = `${ROWS}{"code":"ent","seats":50,"tier":"pro"}\n`
      const created = await apply(workspaceId, {
        'tables/plans.ts': MANAGED,
        'tables/plans.rows.jsonl': three,
      })
      expect(created.failed).toBeUndefined()
      planRowLimit.value = 1
      try {
        const read = await runner.get(workspaceId)
        const twelve = three.replace('"seats":10', '"seats":12')
        const edited = await apply(
          workspaceId,
          { ...read.files, 'tables/plans.rows.jsonl': twelve },
          { base: read.base }
        )
        expect(edited.failed).toBeUndefined()

        const reread = await runner.get(workspaceId)
        const shrunk = await apply(
          workspaceId,
          { ...reread.files, 'tables/plans.rows.jsonl': twelve.split('\n').slice(1).join('\n') },
          { base: reread.base, allowDelete: true }
        )
        expect(shrunk.failed).toBeUndefined()
      } finally {
        planRowLimit.value = undefined
      }
      expect((await storedRows(workspaceId)).map((row) => row.seats).sort()).toEqual([12, 50])
    }
  )

  check(
    'refuses at plan time a column made required that a row the UI added leaves empty, though the rows file is unchanged',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await managedPlans(workspaceId)
      await addUiRow(workspaceId, { code: 'trio' })
      const required = {
        ...read.files,
        'tables/plans.ts': read.files['tables/plans.ts'].replace(
          'seats: column.number()',
          'seats: column.number({ required: true })'
        ),
      }

      const refused = await refusal(apply(workspaceId, required, { base: read.base }))

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_REFUSED'])
      expect(refused.diagnostics[0].message).toContain('"seats" cannot become required')
      const seats = (await storedTable(workspaceId)).schema.columns.find(
        (column) => column.name === 'seats'
      )
      expect(seats?.required).toBeFalsy()
    }
  )

  check('changes the rows key and edits a row in one apply', async () => {
    const workspaceId = await newWorkspace()
    const withEmail = MANAGED.replace(
      "    tier: column.select({ options: ['basic', 'pro'] }),\n",
      "    tier: column.select({ options: ['basic', 'pro'] }),\n    email: column.string({ unique: true }),\n"
    )
    const rows = (soloSeats: number) =>
      `{"code":"solo","seats":${soloSeats},"email":"solo@example.test"}\n{"code":"team","seats":10,"email":"team@example.test"}\n`
    const created = await apply(workspaceId, {
      'tables/plans.ts': withEmail,
      'tables/plans.rows.jsonl': rows(1),
    })
    expect(created.failed).toBeUndefined()
    const read = await runner.get(workspaceId)
    const before = await rowIdentities(workspaceId)

    const rekeyed = {
      'tables/plans.ts': read.files['tables/plans.ts'].replace("key: 'code'", "key: 'email'"),
      'tables/plans.rows.jsonl': rows(5),
    }
    const planned = await apply(workspaceId, rekeyed, { base: read.base, dryRun: true })
    expect(codes(planned.diagnostics)).toEqual([])
    const result = await apply(workspaceId, rekeyed, { base: read.base })

    expect(result.failed).toBeUndefined()
    expect((await storedRows(workspaceId)).map((row) => [row.code, row.seats])).toEqual([
      ['solo', 5],
      ['team', 10],
    ])
    const after = await rowIdentities(workspaceId)
    expect([after.solo.id, after.team.id]).toEqual([before.solo.id, before.team.id])
    const settled = await apply(workspaceId, result.files, { base: result.base })
    expect(settled.applied).toEqual([])
  })

  check(
    "columns one apply drops from managed rows are stripped in one pass, under a timeout scaled past the table write's 10 s default",
    async () => {
      const workspaceId = await newWorkspace()
      const read = await managedPlans(workspaceId)
      const table = await storedTable(workspaceId)
      // A probe on this table's row updates records each one that rewrites cells, and the timeout it
      // ran under.
      const probe = `strip_probe_${table.id.replace(/[^a-z0-9]/gi, '').toLowerCase()}`
      await db.execute(
        sql.raw(`create table ${probe} (row_id text not null, timeout_ms numeric not null)`)
      )
      await db.execute(
        sql.raw(
          `create function ${probe}_fn() returns trigger language plpgsql as $$ begin insert into ${probe} values (new.id, extract(epoch from current_setting('statement_timeout')::interval) * 1000); return new; end $$`
        )
      )
      await db.execute(
        sql.raw(
          `create trigger ${probe}_trg before update on user_table_rows for each row when (new.table_id = '${table.id}' and old.data is distinct from new.data) execute function ${probe}_fn()`
        )
      )
      try {
        const dropped = await apply(
          workspaceId,
          {
            'tables/plans.ts': read.files['tables/plans.ts']
              .replace('    seats: column.number(),\n', '')
              .replace("    tier: column.select({ options: ['basic', 'pro'] }),\n", ''),
            'tables/plans.rows.jsonl': '{"code":"solo"}\n{"code":"team"}\n',
          },
          { base: read.base, allowDelete: true }
        )
        expect(dropped.failed).toBeUndefined()
        const updates = [
          ...(await db.execute<{ passes: number; timeout_ms: number }>(
            sql.raw(
              `select count(*)::int as passes, min(timeout_ms)::int as timeout_ms from ${probe} group by row_id`
            )
          )),
        ]
        expect(updates).toHaveLength(2)
        for (const update of updates) {
          expect(update.passes).toBe(1)
          expect(update.timeout_ms).toBeGreaterThanOrEqual(60_000)
        }
        expect(Object.keys((await storedRows(workspaceId))[0])).toEqual(['code'])
      } finally {
        await db.execute(sql.raw(`drop trigger if exists ${probe}_trg on user_table_rows`))
        await db.execute(sql.raw(`drop function if exists ${probe}_fn()`))
        await db.execute(sql.raw(`drop table if exists ${probe}`))
      }
    }
  )

  check(
    'a column the apply drops leaves no row drift: the next plan sees no server change, and a delete of the table is not stale',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await managedPlans(workspaceId)
      const tierId = (await storedTable(workspaceId)).schema.columns.find(
        (column) => column.name === 'tier'
      )?.id
      if (tierId === undefined) throw new Error('The seeded table has no tier column')
      const dropped = await apply(
        workspaceId,
        {
          'tables/plans.ts': read.files['tables/plans.ts'].replace(
            "    tier: column.select({ options: ['basic', 'pro'] }),\n",
            ''
          ),
          'tables/plans.rows.jsonl': '{"code":"solo","seats":1}\n{"code":"team","seats":10}\n',
        },
        { base: read.base, allowDelete: true }
      )
      expect(dropped.failed).toBeUndefined()
      // The apply strips the dropped column's cells in its own transaction, so none are left.
      const table = await storedTable(workspaceId)
      const [{ holding }] = await db
        .select({ holding: sql<number>`count(*)::int` })
        .from(userTableRows)
        .where(and(eq(userTableRows.tableId, table.id), sql`${userTableRows.data} ? ${tierId}`))
      expect(holding).toBe(0)

      const planned = await apply(workspaceId, dropped.files, {
        base: dropped.base,
        dryRun: true,
      })
      expect(codes(planned.diagnostics, 'warning')).not.toContain('W_SERVER_CHANGED')
      const deleted = await apply(workspaceId, {}, { base: dropped.base, allowDelete: true })
      expect(deleted.applied.map((change) => `${change.action} ${change.key}`)).toEqual([
        'delete plans',
      ])
    }
  )
})
