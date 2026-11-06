/** Runs the recall list query against real PostgreSQL rows, so each filter is proven by a row it drops. */
import { db } from '@sim/db'
import { copilotChats, organization, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { inArray, or } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listRecallChats } from '@/lib/mothership/chat/application/read-recall-chats'

const ownerId = generateId()
const otherUserId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const organizationId = generateId()
const otherOrganizationId = generateId()

const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 10, minute))
const benchmark = { benchmark: { id: 'benchmark-1', operatorUserId: ownerId } }

async function chat(
  values: Partial<typeof copilotChats.$inferInsert> &
    ({ workspaceId: string } | { organizationId: string })
) {
  await db
    .insert(copilotChats)
    .values({ userId: ownerId, type: 'mothership', updatedAt: at(0), ...values })
}

/** The tied pair in the order the query must return them: higher id first. */
const tieOrder = (a: string, b: string) => (a > b ? [a, b] : [b, a])

const workspaceChats = {
  calling: generateId(),
  oldest: generateId(),
  tieA: generateId(),
  tieB: generateId(),
  newest: generateId(),
  plan: generateId(),
}
const organizationChats = {
  calling: generateId(),
  assistant: generateId(),
  agent: generateId(),
  plan: generateId(),
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ownerId, otherUserId].map((id) => ({
      id,
      name: 'Recall chats fixture',
      email: `${id}@recall-chats.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  for (const id of [workspaceId, otherWorkspaceId])
    await insertWorkspaceFixture(db, {
      id,
      name: 'Recall chats fixture',
      ownerId,
      billedAccountUserId: ownerId,
    })
  await db.insert(organization).values(
    [organizationId, otherOrganizationId].map((id) => ({
      id,
      name: 'Recall chats fixture',
      slug: id,
    }))
  )

  await chat({ id: workspaceChats.calling, workspaceId, updatedAt: at(50) })
  await chat({ id: workspaceChats.oldest, workspaceId, title: 'Oldest', updatedAt: at(1) })
  await chat({ id: workspaceChats.tieA, workspaceId, updatedAt: at(2) })
  await chat({ id: workspaceChats.tieB, workspaceId, updatedAt: at(2) })
  await chat({ id: workspaceChats.newest, workspaceId, title: 'Newest', updatedAt: at(3) })
  await chat({
    id: workspaceChats.plan,
    workspaceId,
    config: { conversationMode: 'plan' },
    updatedAt: at(4),
  })
  // Each row below differs from a listed one by exactly one excluded property.
  await chat({ workspaceId, deletedAt: now, updatedAt: at(40) })
  await chat({ workspaceId, config: benchmark, updatedAt: at(41) })
  await chat({ workspaceId, userId: otherUserId, updatedAt: at(42) })
  await chat({ workspaceId: otherWorkspaceId, updatedAt: at(43) })
  await chat({ workspaceId, type: 'copilot', updatedAt: at(44) })

  await chat({ id: organizationChats.calling, organizationId, updatedAt: at(50) })
  await chat({ id: organizationChats.assistant, organizationId, updatedAt: at(1) })
  await chat({
    id: organizationChats.agent,
    organizationId,
    config: { conversationMode: 'agent' },
    updatedAt: at(2),
  })
  await chat({
    id: organizationChats.plan,
    organizationId,
    config: { conversationMode: 'plan' },
    updatedAt: at(3),
  })
  await chat({ organizationId, deletedAt: now, updatedAt: at(40) })
  await chat({ organizationId, config: benchmark, updatedAt: at(41) })
  await chat({ organizationId, userId: otherUserId, updatedAt: at(42) })
  await chat({ organizationId: otherOrganizationId, updatedAt: at(43) })
  await chat({ organizationId, type: 'copilot', updatedAt: at(44) })
})

afterAll(async () => {
  await db
    .delete(copilotChats)
    .where(
      or(
        inArray(copilotChats.workspaceId, [workspaceId, otherWorkspaceId]),
        inArray(copilotChats.organizationId, [organizationId, otherOrganizationId])
      )
    )
  await db
    .delete(organization)
    .where(inArray(organization.id, [organizationId, otherOrganizationId]))
  await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
  await db.delete(user).where(inArray(user.id, [ownerId, otherUserId]))
  await db.$client.end()
})

const ids = (rows: { id: string }[]) => rows.map(({ id }) => id)

describe("listing a chat owner's other live chats", () => {
  const inWorkspace = (includePlanChats: boolean, limit = 50) =>
    listRecallChats({
      userId: ownerId,
      owner: { workspaceId },
      excludeChatId: workspaceChats.calling,
      includePlanChats,
      limit,
    })
  const inOrganization = (includePlanChats: boolean) =>
    listRecallChats({
      userId: ownerId,
      owner: { organizationId },
      excludeChatId: organizationChats.calling,
      includePlanChats,
      limit: 50,
    })

  it("lists only the owner's live home chats in the workspace, newest first and ties by id, without plan chats while Plan mode is off", async () => {
    const rows = await inWorkspace(false)
    expect(ids(rows)).toEqual([
      workspaceChats.newest,
      ...tieOrder(workspaceChats.tieA, workspaceChats.tieB),
      workspaceChats.oldest,
    ])
    expect(rows[0]).toEqual({ id: workspaceChats.newest, title: 'Newest', updatedAt: at(3) })
  })

  it('lists the plan chats too while Plan mode is on', async () => {
    expect(ids(await inWorkspace(true))).toEqual([
      workspaceChats.plan,
      workspaceChats.newest,
      ...tieOrder(workspaceChats.tieA, workspaceChats.tieB),
      workspaceChats.oldest,
    ])
  })

  it("lists only the owner's live home chats in the organization, plan chats only while Plan mode is on", async () => {
    expect(ids(await inOrganization(false))).toEqual([
      organizationChats.agent,
      organizationChats.assistant,
    ])
    expect(ids(await inOrganization(true))).toEqual([
      organizationChats.plan,
      organizationChats.agent,
      organizationChats.assistant,
    ])
  })

  it('stops at the limit, keeping the most recently updated', async () => {
    expect(ids(await inWorkspace(true, 2))).toEqual([workspaceChats.plan, workspaceChats.newest])
  })
})
