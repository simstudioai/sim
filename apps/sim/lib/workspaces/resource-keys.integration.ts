import { db } from '@sim/db'
import {
  credential,
  customTools,
  knowledgeBase,
  mcpServers,
  skill,
  user,
  userTableDefinitions,
  workflow,
  workspace,
  workspaceResourceKey,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import type { ResourceKind } from '@sim/workflow-code'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadResourceKeyResolver } from '@/lib/workflows/code/resources'
import {
  claimResourceKey,
  ResourceKeyTakenError,
  resolveIds,
  resolveKeys,
} from '@/lib/workspaces/resource-keys'

const userId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()

/** Creation times far enough apart that "older" is unambiguous. */
const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 0, minute))

async function insertTable(id: string, wsId: string, name: string, createdAt: Date) {
  await db.insert(userTableDefinitions).values({
    id,
    workspaceId: wsId,
    name,
    schema: { columns: [] },
    createdBy: userId,
    createdAt,
    updatedAt: createdAt,
  })
}

async function keyOf(kind: ResourceKind, id: string, wsId = workspaceId) {
  return (await resolveKeys(wsId, [{ kind, id }], { createdBy: userId })).get(kind)?.get(id)
}

async function idOf(kind: ResourceKind, key: string, wsId = workspaceId) {
  return (await resolveIds(wsId, [{ kind, key }])).get(kind)?.get(key)
}

async function keyRows(wsId: string, kind: ResourceKind, resourceId: string) {
  return db
    .select({ key: workspaceResourceKey.key, origin: workspaceResourceKey.origin })
    .from(workspaceResourceKey)
    .where(
      and(
        eq(workspaceResourceKey.workspaceId, wsId),
        eq(workspaceResourceKey.kind, kind),
        eq(workspaceResourceKey.resourceId, resourceId)
      )
    )
}

/**
 * Holds a transaction open with one uncommitted key row, so a concurrent writer that collides on
 * a unique index blocks on it. Resolves `committed` once the row is committed.
 */
function holdUncommittedKey(row: { key: string; resourceId: string }): {
  committed: Promise<void>
  commit: () => void
} {
  let commit = () => {}
  const released = new Promise<void>((resolve) => {
    commit = resolve
  })
  const committed = db.transaction(async (tx) => {
    const now = new Date()
    await tx.insert(workspaceResourceKey).values({
      id: generateId(),
      workspaceId,
      kind: 'table',
      key: row.key,
      resourceId: row.resourceId,
      origin: 'allocated',
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    await released
  })
  return { committed, commit }
}

/** Waits until some backend is blocked on a lock while writing `workspace_resource_key`. */
async function untilKeyWriteBlocks() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await db.execute<{ pid: number }>(
      sql`select pid from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%workspace_resource_key%'`
    )
    if (rows.length > 0) return
    await sleep(25)
  }
  throw new Error('no key write blocked on a lock')
}

describe('workspace resource keys against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Resource key fixture',
      email: `${userId}@fixture.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(
      db,
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        name: 'Resource key fixture',
        ownerId: userId,
        billedAccountUserId: userId,
      }))
    )
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('allocates a key from the name once, and returns it again without a second row', async () => {
    const older = generateId()
    const newer = generateId()
    await insertTable(older, workspaceId, 'Leads', at(1))
    await insertTable(newer, workspaceId, 'leads!', at(2))

    const first = await resolveKeys(
      workspaceId,
      [
        { kind: 'table', id: newer },
        { kind: 'table', id: older },
      ],
      { createdBy: userId }
    )
    expect(first.get('table')?.get(older)).toBe('leads')
    expect(first.get('table')?.get(newer)).toBe('leads-2')

    expect(await keyOf('table', older)).toBe('leads')
    expect(await keyRows(workspaceId, 'table', older)).toEqual([
      { key: 'leads', origin: 'allocated' },
    ])
    expect(await idOf('table', 'leads-2')).toBe(newer)
  })

  it('gives one key to a resource two concurrent calls allocate', async () => {
    const id = generateId()
    await insertTable(id, workspaceId, 'Orders', at(3))

    const keys = await Promise.all(Array.from({ length: 6 }, () => keyOf('table', id)))

    expect(new Set(keys)).toEqual(new Set(['orders']))
    expect(await keyRows(workspaceId, 'table', id)).toHaveLength(1)
  })

  it('gives distinct keys to same-named resources allocated concurrently', async () => {
    /** Live tables need distinct names, so the three differ only in what the key drops. */
    const tables = ['Invoices', 'invoices', 'Invoices!'].map((name) => ({ id: generateId(), name }))
    await Promise.all(
      tables.map(({ id, name }, index) => insertTable(id, workspaceId, name, at(4 + index)))
    )

    const keys = await Promise.all(tables.map(({ id }) => keyOf('table', id)))

    expect(new Set(keys)).toEqual(new Set(['invoices', 'invoices-2', 'invoices-3']))
  })

  it('keeps every kind’s key through a rename', async () => {
    const ids = {
      table: generateId(),
      kb: generateId(),
      workflow: generateId(),
      tool: generateId(),
      skill: generateId(),
      mcp: generateId(),
      credential: generateId(),
    }
    const now = at(10)
    await insertTable(ids.table, workspaceId, 'Rename Table', now)
    await db.insert(knowledgeBase).values({
      id: ids.kb,
      userId,
      workspaceId,
      name: 'Rename KB',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workflow).values({
      id: ids.workflow,
      userId,
      workspaceId,
      name: 'Rename Workflow',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(customTools).values({
      id: ids.tool,
      workspaceId,
      userId,
      title: 'Rename Tool',
      schema: {},
      code: 'return 1',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(skill).values({
      id: ids.skill,
      workspaceId,
      userId,
      name: 'rename-skill',
      description: 'fixture',
      content: 'fixture',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(mcpServers).values({
      id: ids.mcp,
      workspaceId,
      createdBy: userId,
      name: 'Rename MCP',
      transport: 'streamable-http',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(credential).values({
      id: ids.credential,
      workspaceId,
      type: 'env_workspace',
      displayName: 'Rename Credential',
      envKey: `RENAME_${ids.credential.replaceAll('-', '_').toUpperCase()}`,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })

    const cases: Array<[ResourceKind, string, string, () => Promise<unknown>]> = [
      [
        'table',
        ids.table,
        'rename-table',
        () =>
          db
            .update(userTableDefinitions)
            .set({ name: 'Renamed' })
            .where(eq(userTableDefinitions.id, ids.table)),
      ],
      [
        'knowledge-base',
        ids.kb,
        'rename-kb',
        () => db.update(knowledgeBase).set({ name: 'Renamed' }).where(eq(knowledgeBase.id, ids.kb)),
      ],
      [
        'workflow',
        ids.workflow,
        'rename-workflow',
        () => db.update(workflow).set({ name: 'Renamed' }).where(eq(workflow.id, ids.workflow)),
      ],
      [
        'custom-tool',
        ids.tool,
        'rename-tool',
        () => db.update(customTools).set({ title: 'Renamed' }).where(eq(customTools.id, ids.tool)),
      ],
      [
        'skill',
        ids.skill,
        'rename-skill',
        () => db.update(skill).set({ name: 'renamed' }).where(eq(skill.id, ids.skill)),
      ],
      [
        'mcp-server',
        ids.mcp,
        'rename-mcp',
        () => db.update(mcpServers).set({ name: 'Renamed' }).where(eq(mcpServers.id, ids.mcp)),
      ],
      [
        'credential',
        ids.credential,
        'rename-credential',
        () =>
          db
            .update(credential)
            .set({ displayName: 'Renamed' })
            .where(eq(credential.id, ids.credential)),
      ],
    ]

    for (const [kind, id, expectedKey, rename] of cases) {
      expect(await keyOf(kind, id)).toBe(expectedKey)
      await rename()
      expect(await keyOf(kind, id)).toBe(expectedKey)
      expect(await idOf(kind, expectedKey)).toBe(id)
      expect(await idOf(kind, 'renamed')).toBeUndefined()
    }
  })

  it('never re-points the key of a deleted older resource at a newer same-named one', async () => {
    const older = generateId()
    const newer = generateId()
    await insertTable(older, workspaceId, 'Docs', at(20))
    await insertTable(newer, workspaceId, 'docs', at(21))
    expect(await keyOf('table', older)).toBe('docs')

    await db
      .update(userTableDefinitions)
      .set({ archivedAt: new Date() })
      .where(eq(userTableDefinitions.id, older))

    expect(await idOf('table', 'docs')).toBeUndefined()
    expect(await keyOf('table', older)).toBeUndefined()
    expect(await keyOf('table', newer)).toBe('docs-2')
    expect(await keyRows(workspaceId, 'table', older)).toEqual([
      { key: 'docs', origin: 'allocated' },
    ])

    const resolver = await loadResourceKeyResolver(
      workspaceId,
      { ids: [{ kind: 'table', id: newer }], keys: [{ kind: 'table', key: 'docs' }] },
      { actorUserId: userId }
    )
    expect(resolver.toId('table', 'docs')).toBeNull()
    expect(resolver.toId('table', 'docs-2')).toBe(newer)
  })

  it('never resolves a key or id across workspaces', async () => {
    const foreign = generateId()
    await insertTable(foreign, otherWorkspaceId, 'Payroll', at(30))
    expect(await keyOf('table', foreign, otherWorkspaceId)).toBe('payroll')

    expect(await idOf('table', 'payroll')).toBeUndefined()
    expect(await keyOf('table', foreign)).toBeUndefined()
    expect(await keyRows(workspaceId, 'table', foreign)).toEqual([])
  })

  it('resolves only bound keys and allocates none when a read asks it not to', async () => {
    const bound = generateId()
    const unbound = generateId()
    await insertTable(bound, workspaceId, 'Bound', at(35))
    await insertTable(unbound, workspaceId, 'Unbound', at(36))
    expect(await keyOf('table', bound)).toBe('bound')

    const resolver = await loadResourceKeyResolver(
      workspaceId,
      {
        ids: [
          { kind: 'table', id: bound },
          { kind: 'table', id: unbound },
        ],
      },
      { actorUserId: userId, allocate: false }
    )

    expect(resolver.toKey('table', bound)).toBe('bound')
    expect(resolver.toKey('table', unbound)).toBeNull()
    expect(await keyRows(workspaceId, 'table', unbound)).toEqual([])
  })

  it('allocates inside the caller’s transaction and rolls back with it', async () => {
    const id = generateId()
    await insertTable(id, workspaceId, 'Rollback', at(40))

    await expect(
      db.transaction(async (tx) => {
        const keys = await resolveKeys(workspaceId, [{ kind: 'table', id }], { executor: tx })
        expect(keys.get('table')?.get(id)).toBe('rollback')
        throw new Error('roll back')
      })
    ).rejects.toThrow('roll back')

    expect(await keyRows(workspaceId, 'table', id)).toEqual([])
  })

  it('refuses a claim with ResourceKeyTakenError when another resource takes the key concurrently', async () => {
    const holder = generateId()
    const claimant = generateId()
    await insertTable(holder, workspaceId, 'Race Holder', at(50))
    await insertTable(claimant, workspaceId, 'Race Claimant', at(51))
    const held = holdUncommittedKey({ key: 'race-leads', resourceId: holder })

    const claim = claimResourceKey({
      workspaceId,
      kind: 'table',
      key: 'race-leads',
      resourceId: claimant,
      origin: 'created',
      createdBy: userId,
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    await untilKeyWriteBlocks()
    held.commit()
    await held.committed

    const outcome = await claim
    expect('error' in outcome && outcome.error).toBeInstanceOf(ResourceKeyTakenError)
    expect(await keyRows(workspaceId, 'table', holder)).toEqual([
      { key: 'race-leads', origin: 'allocated' },
    ])
    expect(await keyRows(workspaceId, 'table', claimant)).toEqual([])
  })

  it('binds the claimed key when a get allocates the resource another key concurrently', async () => {
    const id = generateId()
    await insertTable(id, workspaceId, 'Race Allocated', at(52))
    const held = holdUncommittedKey({ key: 'race-allocated', resourceId: id })

    const claim = claimResourceKey({
      workspaceId,
      kind: 'table',
      key: 'race-named',
      resourceId: id,
      origin: 'adopted',
      createdBy: userId,
    })
    await untilKeyWriteBlocks()
    held.commit()
    await held.committed

    expect(await claim).toBe('bound')
    expect(await keyRows(workspaceId, 'table', id)).toEqual([
      { key: 'race-named', origin: 'adopted' },
    ])
  })
})
