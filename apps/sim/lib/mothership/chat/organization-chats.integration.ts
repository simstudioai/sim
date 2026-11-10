/**
 * Who may chat in an organization, on a billed deployment against real PostgreSQL: chat follows the
 * permission group's `copilot.use` alone, never the member's role, so a plain member starts and
 * continues an agent chat, and the same member is refused once the organization's permission group
 * withholds Chat. Failure modes: a member refused for not being an administrator; a member let in
 * after the group withholds Chat; the surface projection and the chat use case disagreeing.
 */
import { db } from '@sim/db'
import {
  copilotChats,
  member,
  organization,
  permissionGroup,
  permissions,
  subscription,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.BILLING_ENABLED = 'true'
})

import {
  listMothershipChats,
  listOpenableChatWorkspaceIds,
} from '@/lib/mothership/chat/list-mothership-chats'
import {
  authorizeOrganizationChat,
  createOrganizationChat,
} from '@/lib/mothership/chat/organization-chats'
import { getOrganizationSurfaceGate } from '@/lib/organizations/surface'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'

const ids = {
  organization: `chat-access-org-${generateId()}`,
  owner: `chat-access-owner-${generateId()}`,
  member: `chat-access-member-${generateId()}`,
  group: `chat-access-group-${generateId()}`,
  granted: `chat-access-granted-${generateId()}`,
  archived: `chat-access-archived-${generateId()}`,
  administered: `chat-access-administered-${generateId()}`,
}
const fixtureWorkspaces = [ids.granted, ids.archived, ids.administered]
const principal = { kind: 'session' as const, userId: ids.member, sessionId: 'chat-access' }
const input = { organizationId: ids.organization, mode: 'agent' as const }

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ids.owner, ids.member].map((id) => ({
      id,
      name: 'Chat access fixture',
      email: `${id}@chat-access.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db
    .insert(organization)
    .values({ id: ids.organization, name: 'Chat access', slug: ids.organization, createdAt: now })
  await db.insert(member).values([
    { id: generateId(), organizationId: ids.organization, userId: ids.owner, role: 'owner' },
    { id: generateId(), organizationId: ids.organization, userId: ids.member, role: 'member' },
  ])
  await db.insert(subscription).values({
    id: generateId(),
    plan: 'enterprise',
    referenceId: ids.organization,
    status: 'active',
    seats: 10,
    metadata: { plan: 'enterprise', referenceId: ids.organization, seats: 10 },
    periodStart: now,
    periodEnd: new Date(now.getTime() + 30 * 86_400_000),
  })
})

afterAll(async () => {
  await db.delete(copilotChats).where(eq(copilotChats.organizationId, ids.organization))
  await db.delete(copilotChats).where(inArray(copilotChats.workspaceId, fixtureWorkspaces))
  await db.delete(permissions).where(inArray(permissions.entityId, fixtureWorkspaces))
  await deleteWorkspaceFixture(db, inArray(workspace.id, fixtureWorkspaces))
  await db.delete(subscription).where(eq(subscription.referenceId, ids.organization))
  await db.delete(organization).where(eq(organization.id, ids.organization))
  await db.delete(user).where(inArray(user.id, [ids.owner, ids.member]))
})

describe('organization chat access on a billed deployment', () => {
  it('lets a plain member start and continue an agent chat', async () => {
    const chat = await createOrganizationChat.execute({ principal, input })
    const [row] = await db
      .select({ userId: copilotChats.userId })
      .from(copilotChats)
      .where(eq(copilotChats.id, chat.id))
    expect(row?.userId).toBe(ids.member)
    await expect(authorizeOrganizationChat.execute({ principal, input })).resolves.toMatchObject({
      userId: ids.member,
      role: 'member',
    })
    expect(await getOrganizationSurfaceGate(ids.organization, ids.member)).toMatchObject({
      mothershipAvailable: true,
    })
  })

  it('refuses the same member once the permission group withholds Chat', async () => {
    await db.insert(permissionGroup).values({
      id: ids.group,
      organizationId: ids.organization,
      name: 'No chat',
      config: { hideCopilot: true },
      createdBy: ids.owner,
      isDefault: true,
    })
    const before = await db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(eq(copilotChats.organizationId, ids.organization))
    for (const mode of ['agent', 'assistant'] as const) {
      await expect(
        createOrganizationChat.execute({ principal, input: { ...input, mode } })
      ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
      await expect(
        authorizeOrganizationChat.execute({ principal, input: { ...input, mode } })
      ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
    }
    const after = await db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(eq(copilotChats.organizationId, ids.organization))
    expect(after).toHaveLength(before.length)
    expect(await getOrganizationSurfaceGate(ids.organization, ids.member)).toMatchObject({
      mothershipAvailable: false,
    })
  })
})

/**
 * Chats touched in the same instant (a bulk move, a backfill) tie on `updatedAt`. Failure mode: the
 * tie left to the planner, so a limited first page and the full list disagree on which chats lead,
 * and paging repeats or skips one.
 */
describe("the organization's chat list order", () => {
  it('breaks a tie on the update time by id, the same with and without a limit', async () => {
    const tiedAt = new Date('2026-06-01T00:00:00.000Z')
    const rows = await db
      .insert(copilotChats)
      .values(
        [0, 1, 2].map(() => ({
          userId: ids.owner,
          organizationId: ids.organization,
          type: 'mothership' as const,
          updatedAt: tiedAt,
        }))
      )
      .returning({ id: copilotChats.id })
    const tied = new Set(rows.map((row) => row.id))
    const byIdDescending = [...tied].sort((left, right) => compareStrings(right, left))

    const listed = async (limit?: number) =>
      (await listMothershipChats(ids.owner, { organizationId: ids.organization }, 'active', limit))
        .map((chat) => chat.id)
        .filter((id) => tied.has(id))

    expect(await listed()).toEqual(byIdDescending)
    expect(await listed(2)).toEqual(byIdDescending.slice(0, 2))
  })
})

/**
 * An organization's list also holds the viewer's chats on every workspace they can still open.
 * Failure modes: a chat on a workspace granted to the viewer left out; one on an archived
 * workspace, or on a workspace of the organization a plain member holds no grant to, let in; and
 * an administrator of a team organization losing the chats on its workspaces they hold no grant to.
 */
describe("the organization's list of workspace chats", () => {
  it('holds chats on workspaces the viewer can open, and only those', async () => {
    const now = new Date()
    await insertWorkspaceFixture(db, [
      { id: ids.granted, name: 'Granted', ownerId: ids.owner, billedAccountUserId: ids.owner },
      {
        id: ids.archived,
        name: 'Archived',
        ownerId: ids.owner,
        billedAccountUserId: ids.owner,
        archivedAt: now,
      },
      {
        id: ids.administered,
        name: 'Administered',
        ownerId: ids.owner,
        billedAccountUserId: ids.owner,
        organizationId: ids.organization,
      },
    ])
    await db.insert(permissions).values(
      [ids.granted, ids.archived].map((entityId) => ({
        id: generateId(),
        userId: ids.member,
        entityType: 'workspace',
        entityId,
        permissionType: 'write' as const,
      }))
    )
    const chats = await db
      .insert(copilotChats)
      .values([
        ...fixtureWorkspaces.map((workspaceId) => ({
          userId: ids.member,
          workspaceId,
          type: 'mothership' as const,
        })),
        { userId: ids.owner, workspaceId: ids.administered, type: 'mothership' as const },
      ])
      .returning({
        id: copilotChats.id,
        userId: copilotChats.userId,
        workspaceId: copilotChats.workspaceId,
      })
    const chatOn = (userId: string, workspaceId: string) =>
      chats.find((chat) => chat.userId === userId && chat.workspaceId === workspaceId)?.id
    const listed = async (userId: string) =>
      new Set(
        (await listMothershipChats(userId, { organizationId: ids.organization })).map(
          (chat) => chat.id
        )
      )

    const memberList = await listed(ids.member)
    expect(memberList.has(chatOn(ids.member, ids.granted) ?? '')).toBe(true)
    expect(memberList.has(chatOn(ids.member, ids.archived) ?? '')).toBe(false)
    expect(memberList.has(chatOn(ids.member, ids.administered) ?? '')).toBe(false)
    expect(
      [...(await listOpenableChatWorkspaceIds(ids.member))].filter((id) =>
        fixtureWorkspaces.includes(id)
      )
    ).toEqual([ids.granted])

    expect((await listed(ids.owner)).has(chatOn(ids.owner, ids.administered) ?? '')).toBe(true)
  })
})
