/**
 * The batched mention reads against real PostgreSQL. Each family is one query across the
 * workspaces its caller authorized, so its predicates carry the whole boundary. Failure modes: a
 * row from a workspace outside the passed set; an archived, deleted, foreign-context or other
 * user's row that the family's own list excludes; a weaker name match ranked above a stronger one
 * or a limit overrun; and a file found by anything but its name.
 */
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
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type MentionReadSpec,
  readChatMentions,
  readFileFolderMentions,
  readFileMentions,
  readFolderMentions,
  readKnowledgeBaseMentions,
  readTableMentions,
  readWorkflowMentions,
} from '@/lib/mentions/queries'

const viewer = `mentions-viewer-${generateId()}`
const other = `mentions-other-${generateId()}`
const inScope = [`mentions-ws-a-${generateId()}`, `mentions-ws-b-${generateId()}`]
const outOfScope = `mentions-ws-c-${generateId()}`
const allWorkspaces = [...inScope, outOfScope]
const archived = new Date('2026-01-01T00:00:00.000Z')

/** A distinct update time per row, so recency order is fixed. */
let clock = Date.parse('2026-06-01T00:00:00.000Z')
const tick = () => new Date((clock += 60_000))

function spec(overrides: Partial<MentionReadSpec> = {}): MentionReadSpec {
  return { workspaceIds: inScope, query: '', matchedWorkspaceIds: [], limit: 50, ...overrides }
}

const names = (rows: { name: string }[]) => rows.map((row) => row.name).sort()

async function seedWorkflow(workspaceId: string, name: string, extra = {}) {
  const now = tick()
  const id = generateId()
  await db.insert(workflow).values({
    id,
    userId: viewer,
    workspaceId,
    name,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
    ...extra,
  })
  return id
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [viewer, other].map((id) => ({
      id,
      name: 'Mentions fixture',
      email: `${id}@mentions.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await insertWorkspaceFixture(
    db,
    allWorkspaces.map((id) => ({
      id,
      name: id,
      ownerId: viewer,
      billedAccountUserId: viewer,
    }))
  )

  for (const workspaceId of allWorkspaces) {
    const label = workspaceId === outOfScope ? 'outside' : workspaceId === inScope[0] ? 'a' : 'b'
    await seedWorkflow(workspaceId, `Workflow ${label}`)
    await db.insert(userTableDefinitions).values({
      id: generateId(),
      workspaceId,
      name: `Table ${label}`,
      schema: { columns: [] },
      createdBy: viewer,
      updatedAt: tick(),
    })
    await db.insert(knowledgeBase).values({
      id: generateId(),
      workspaceId,
      name: `Base ${label}`,
      userId: viewer,
      updatedAt: tick(),
    })
    await db.insert(copilotChats).values({
      workspaceId,
      userId: viewer,
      type: 'mothership',
      title: `Chat ${label}`,
      updatedAt: tick(),
    })
    await db.insert(folder).values([
      {
        id: generateId(),
        workspaceId,
        userId: viewer,
        resourceType: 'workflow',
        name: `Workflow folder ${label}`,
        updatedAt: tick(),
      },
      {
        id: generateId(),
        workspaceId,
        userId: viewer,
        resourceType: 'file',
        name: `File folder ${label}`,
        updatedAt: tick(),
      },
    ])
    await db.insert(workspaceFiles).values({
      id: generateId(),
      key: `mentions/${generateId()}`,
      userId: viewer,
      workspaceId,
      context: 'workspace',
      originalName: `file-${label}.txt`,
      contentType: 'text/plain',
      sizeBytes: 1,
      updatedAt: tick(),
    })
  }

  const [a] = inScope
  // Rows each family's own list leaves out, all in an authorized workspace.
  await seedWorkflow(a, 'Workflow archived', { archivedAt: archived })
  await db.insert(userTableDefinitions).values({
    id: generateId(),
    workspaceId: a,
    name: 'Table archived',
    schema: { columns: [] },
    createdBy: viewer,
    archivedAt: archived,
  })
  await db.insert(knowledgeBase).values({
    id: generateId(),
    workspaceId: a,
    name: 'Base deleted',
    userId: viewer,
    deletedAt: archived,
  })
  await db.insert(copilotChats).values([
    {
      workspaceId: a,
      userId: viewer,
      type: 'mothership',
      title: 'Chat deleted',
      deletedAt: archived,
    },
    { workspaceId: a, userId: other, type: 'mothership', title: 'Chat of another member' },
    { workspaceId: a, userId: viewer, title: 'Chat of another kind', type: 'copilot' },
    {
      workspaceId: a,
      userId: viewer,
      type: 'mothership',
      title: 'Chat benchmark',
      config: { benchmark: true },
    },
  ])
  await db.insert(folder).values([
    {
      id: generateId(),
      workspaceId: a,
      userId: viewer,
      resourceType: 'workflow',
      name: 'Workflow folder deleted',
      deletedAt: archived,
    },
    {
      id: generateId(),
      workspaceId: a,
      userId: viewer,
      resourceType: 'table',
      name: 'Table folder',
    },
  ])
  await db.insert(workspaceFiles).values([
    {
      id: generateId(),
      key: `mentions/${generateId()}`,
      userId: viewer,
      workspaceId: a,
      context: 'workspace',
      originalName: 'file-deleted.txt',
      contentType: 'text/plain',
      sizeBytes: 1,
      deletedAt: archived,
    },
    {
      id: generateId(),
      key: `mentions/${generateId()}`,
      userId: viewer,
      workspaceId: a,
      context: 'mothership',
      originalName: 'file-chat-upload.txt',
      contentType: 'text/plain',
      sizeBytes: 1,
    },
  ])
})

afterAll(async () => {
  await db.delete(copilotChats).where(inArray(copilotChats.workspaceId, allWorkspaces))
  await db.delete(workspaceFiles).where(inArray(workspaceFiles.workspaceId, allWorkspaces))
  await db.delete(knowledgeBase).where(inArray(knowledgeBase.workspaceId, allWorkspaces))
  await db
    .delete(userTableDefinitions)
    .where(inArray(userTableDefinitions.workspaceId, allWorkspaces))
  await db.delete(workflow).where(inArray(workflow.workspaceId, allWorkspaces))
  await db.delete(folder).where(inArray(folder.workspaceId, allWorkspaces))
  await deleteWorkspaceFixture(db, inArray(workspace.id, allWorkspaces))
  await db.delete(user).where(inArray(user.id, [viewer, other]))
})

describe('each family across the passed workspaces', () => {
  it('lists only what the family list lists, and nothing from other workspaces', async () => {
    expect(names(await readWorkflowMentions(spec()))).toEqual(['Workflow a', 'Workflow b'])
    expect(names(await readTableMentions(spec()))).toEqual(['Table a', 'Table b'])
    expect(names(await readKnowledgeBaseMentions(spec()))).toEqual(['Base a', 'Base b'])
    expect(names(await readChatMentions(spec(), viewer))).toEqual(['Chat a', 'Chat b'])
    expect(names(await readFileMentions(spec()))).toEqual(['file-a.txt', 'file-b.txt'])
    expect(names(await readFileFolderMentions(spec()))).toEqual(['File folder a', 'File folder b'])
    expect(
      (await readFolderMentions(spec(), ['workflow', 'table'])).map((row) => [
        row.name,
        row.folderFamily,
      ])
    ).toEqual(
      expect.arrayContaining([
        ['Workflow folder a', 'Workflow folders'],
        ['Workflow folder b', 'Workflow folders'],
        ['Table folder', 'Table folders'],
      ])
    )
    expect(await readFolderMentions(spec(), ['workflow', 'table'])).toHaveLength(3)
  })

  it('reads nothing for an empty workspace set', async () => {
    expect(await readWorkflowMentions(spec({ workspaceIds: [] }))).toEqual([])
  })
})

describe('an @ query', () => {
  it('ranks an exact name, then a prefix, then a substring, within the limit', async () => {
    const [a] = inScope
    // Removed again afterwards, so no other case's workflow list depends on running before this.
    const seeded = [
      await seedWorkflow(a, 'Invoice reports'),
      await seedWorkflow(a, 'Sync invoice'),
      await seedWorkflow(a, 'Invoice'),
    ]
    try {
      const rows = await readWorkflowMentions(spec({ query: 'invoice', limit: 2 }))
      expect(rows.map((row) => row.name)).toEqual(['Invoice', 'Invoice reports'])
      const all = await readWorkflowMentions(spec({ query: 'invoice' }))
      expect(all.map((row) => row.name)).toEqual(['Invoice', 'Invoice reports', 'Sync invoice'])
    } finally {
      await db.delete(workflow).where(inArray(workflow.id, seeded))
    }
  })

  it('offers the most recently updated rows when nothing is typed', async () => {
    const rows = await readTableMentions(spec({ limit: 1 }))
    expect(rows.map((row) => row.name)).toEqual(['Table b'])
  })

  it('lists every row of a workspace whose name the query matches', async () => {
    const [, b] = inScope
    const rows = await readTableMentions(spec({ query: 'zzz', matchedWorkspaceIds: [b] }))
    expect(names(rows)).toEqual(['Table b'])
  })

  it('finds a file by its name and only by its name', async () => {
    expect(names(await readFileMentions(spec({ query: 'FILE-A' })))).toEqual(['file-a.txt'])
    expect(await readFileMentions(spec({ query: 'mentions/' }))).toEqual([])
  })
})
