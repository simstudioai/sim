import { db } from '@sim/db'
import {
  copilotChats,
  folder,
  knowledgeBase,
  user,
  userTableDefinitions,
  workflow,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  RECENTLY_DELETED_ITEM_TYPES,
  type RecentlyDeletedItem,
  type RecentlyDeletedSortColumn,
} from '@/lib/api/contracts/recently-deleted'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { listRecentlyDeletedItems } from '@/lib/workspaces/recently-deleted'

const aliceId = generateId()
const bobId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()

const ALL_TYPES = new Set(RECENTLY_DELETED_ITEM_TYPES)

/** Bound as PostgreSQL text so fixtures keep their microseconds. */
function at(timestamp: string) {
  return sql`${timestamp}::timestamp`
}

const ids = {
  workflowOld: generateId(),
  workflowNew: generateId(),
  workflowActive: generateId(),
  workflowFolder: generateId(),
  knowledgeFolder: generateId(),
  table: generateId(),
  knowledge: generateId(),
  fileA: generateId(),
  fileB: generateId(),
  knowledgeContextFile: generateId(),
  fileFolder: generateId(),
  aliceChat: generateId(),
  aliceCopilotChat: generateId(),
  bobChat: generateId(),
  otherWorkspaceWorkflow: generateId(),
}

/** Every row the trash should list for Alice, as `[id, name, deletedAt]`. */
const VISIBLE = [
  [ids.workflowOld, 'Alpha flow', '2026-09-01T10:00:00.000Z'],
  [ids.fileFolder, 'Docs', '2026-09-01T10:00:00.000Z'],
  [ids.workflowFolder, 'Folder A', '2026-09-02T10:00:00.000Z'],
  [ids.knowledgeFolder, 'KB folder', '2026-09-02T10:00:00.000Z'],
  [ids.workflowNew, 'beta 100% done', '2026-09-03T10:00:00.123Z'],
  [ids.table, 'Orders', '2026-09-03T10:00:00.123Z'],
  [ids.knowledge, 'Handbook', '2026-09-04T10:00:00.000Z'],
  [ids.fileA, 'same.txt', '2026-09-05T10:00:00.000Z'],
  [ids.fileB, 'same.txt', '2026-09-05T10:00:00.000Z'],
  [ids.aliceChat, 'New chat', '2026-09-06T10:00:00.000Z'],
] as const

async function walk(
  sortBy: RecentlyDeletedSortColumn,
  sortOrder: ListSortOrder,
  limit: number,
  search?: string
): Promise<RecentlyDeletedItem[]> {
  const items: RecentlyDeletedItem[] = []
  let cursorKeys: CursorKey[] | undefined
  for (let page = 0; page < 50; page++) {
    const result = await listRecentlyDeletedItems({
      workspaceId,
      types: ALL_TYPES,
      chatUserId: aliceId,
      search,
      sortBy,
      sortOrder,
      limit,
      cursorKeys,
    })
    items.push(...result.items)
    if (!result.nextCursorKeys) return items
    cursorKeys = result.nextCursorKeys
  }
  throw new Error('pagination did not terminate')
}

describe('Recently Deleted listing against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values(
      [aliceId, bobId].map((id) => ({
        id,
        name: 'Recently deleted fixture',
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await insertWorkspaceFixture(
      db,
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        name: 'Recently deleted fixture',
        ownerId: aliceId,
        billedAccountUserId: aliceId,
      }))
    )
    const workflowRow = (id: string, wsId: string, name: string, archivedAt: string | null) => ({
      id,
      userId: aliceId,
      workspaceId: wsId,
      name,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      archivedAt: archivedAt === null ? null : at(archivedAt),
    })
    await db
      .insert(workflow)
      .values([
        workflowRow(ids.workflowOld, workspaceId, 'Alpha flow', '2026-09-01 10:00:00.000400'),
        workflowRow(ids.workflowNew, workspaceId, 'beta 100% done', '2026-09-03 10:00:00.123001'),
        workflowRow(ids.workflowActive, workspaceId, 'Active flow', null),
        workflowRow(ids.otherWorkspaceWorkflow, otherWorkspaceId, 'Elsewhere', '2026-09-09'),
      ])
    await db.insert(folder).values([
      {
        id: ids.workflowFolder,
        resourceType: 'workflow',
        name: 'Folder A',
        userId: aliceId,
        workspaceId,
        deletedAt: at('2026-09-02 10:00:00'),
      },
      {
        id: ids.knowledgeFolder,
        resourceType: 'knowledge_base',
        name: 'KB folder',
        userId: aliceId,
        workspaceId,
        deletedAt: at('2026-09-02 10:00:00'),
      },
      {
        id: ids.fileFolder,
        resourceType: 'file',
        name: 'Docs',
        userId: aliceId,
        workspaceId,
        deletedAt: at('2026-09-01 10:00:00.000400'),
      },
    ])
    await db.insert(userTableDefinitions).values({
      id: ids.table,
      workspaceId,
      name: 'Orders',
      schema: { columns: [] },
      createdBy: aliceId,
      archivedAt: at('2026-09-03 10:00:00.123999'),
    })
    await db.insert(knowledgeBase).values({
      id: ids.knowledge,
      userId: aliceId,
      workspaceId,
      name: 'Handbook',
      deletedAt: at('2026-09-04 10:00:00'),
    })
    const fileRow = (id: string, context: string, folderId: string | null, deletedAt: string) => ({
      id,
      key: `fixture/${id}`,
      userId: aliceId,
      workspaceId,
      folderId,
      context,
      originalName: context === 'workspace' ? 'same.txt' : 'kb-source.pdf',
      contentType: 'text/plain',
      deletedAt: at(deletedAt),
    })
    await db
      .insert(workspaceFiles)
      .values([
        fileRow(ids.fileA, 'workspace', null, '2026-09-05 10:00:00'),
        fileRow(ids.fileB, 'workspace', ids.fileFolder, '2026-09-05 10:00:00'),
        fileRow(ids.knowledgeContextFile, 'knowledge-base', null, '2026-09-07 10:00:00'),
      ])
    await db.insert(copilotChats).values([
      {
        id: ids.aliceChat,
        userId: aliceId,
        workspaceId,
        type: 'mothership',
        deletedAt: at('2026-09-06 10:00:00'),
      },
      {
        id: ids.aliceCopilotChat,
        userId: aliceId,
        workspaceId,
        type: 'copilot',
        title: 'Copilot chat',
        deletedAt: at('2026-09-08 10:00:00'),
      },
      {
        id: ids.bobChat,
        userId: bobId,
        workspaceId,
        type: 'mothership',
        title: 'Bob chat',
        deletedAt: at('2026-09-08 10:00:00'),
      },
    ])
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
    await db.delete(user).where(inArray(user.id, [aliceId, bobId]))
    await db.$client.end()
  })

  it('lists every visible archived row across types and scopes, newest first', async () => {
    const items = await walk('deleted', 'desc', 100)
    expect(new Set(items.map((item) => item.id))).toEqual(new Set(VISIBLE.map(([id]) => id)))
    expect(items[0]?.id).toBe(ids.aliceChat)
    for (const [id, name, deletedAt] of VISIBLE) {
      expect(items.find((item) => item.id === id)).toMatchObject({ name, deletedAt })
    }
    expect(items.find((item) => item.id === ids.workflowFolder)?.parentId).toBeNull()
  })

  it.each([
    ['deleted', 'desc'],
    ['deleted', 'asc'],
    ['name', 'asc'],
    ['name', 'desc'],
    ['type', 'asc'],
    ['type', 'desc'],
  ] as const)(
    'pages through %s %s one row at a time without skipping or repeating',
    async (sortBy, sortOrder) => {
      const whole = await walk(sortBy, sortOrder, 100)
      expect(whole).toHaveLength(VISIBLE.length)
      for (const limit of [1, 2, 3]) {
        expect(await walk(sortBy, sortOrder, limit)).toEqual(whole)
      }
    }
  )

  it('orders rows tied on deletion time by name, then id, ascending either way', async () => {
    for (const sortOrder of ['asc', 'desc'] as const) {
      const order = (await walk('deleted', sortOrder, 100)).map((item) => item.id)
      expect(order.indexOf(ids.workflowFolder)).toBeLessThan(order.indexOf(ids.knowledgeFolder))
      expect(order.indexOf(ids.workflowOld)).toBeLessThan(order.indexOf(ids.fileFolder))
      const [firstSame, secondSame] = [ids.fileA, ids.fileB].sort(
        (a, b) => order.indexOf(a) - order.indexOf(b)
      )
      expect(order.indexOf(firstSame) + 1).toBe(order.indexOf(secondSame))
    }
  })

  it('keeps microsecond-apart rows of different types on the right side of a page boundary', async () => {
    const items = await walk('deleted', 'desc', 1)
    const order = items.map((item) => item.id)
    expect(order.indexOf(ids.table)).toBe(order.indexOf(ids.workflowNew) - 1)
  })

  it('searches names case-insensitively and literally', async () => {
    expect((await walk('deleted', 'desc', 2, 'ALPHA')).map((item) => item.id)).toEqual([
      ids.workflowOld,
    ])
    expect((await walk('deleted', 'desc', 2, '100%')).map((item) => item.id)).toEqual([
      ids.workflowNew,
    ])
    expect(await walk('deleted', 'desc', 2, '_')).toEqual([])
    expect((await walk('name', 'asc', 1, 'new chat')).map((item) => item.id)).toEqual([
      ids.aliceChat,
    ])
  })

  it('narrows to the requested types and leaves chats out without a viewer', async () => {
    const page = await listRecentlyDeletedItems({
      workspaceId,
      types: new Set(['table', 'table_folder', 'chat']),
      chatUserId: null,
      sortBy: 'deleted',
      sortOrder: 'desc',
      limit: 10,
    })
    expect(page.items.map((item) => item.id)).toEqual([ids.table])
    expect(page.nextCursorKeys).toBeNull()
  })

  it('refuses a cursor that does not fit the sort', async () => {
    for (const cursorKeys of [['2026-09-01T00:00:00.000Z', 'a', 'b'], ['only-one'], [1, 'a']]) {
      await expect(
        listRecentlyDeletedItems({
          workspaceId,
          types: ALL_TYPES,
          chatUserId: aliceId,
          sortBy: 'deleted',
          sortOrder: 'desc',
          limit: 10,
          cursorKeys,
        })
      ).rejects.toMatchObject({ code: 'validation' })
    }
  })
})
