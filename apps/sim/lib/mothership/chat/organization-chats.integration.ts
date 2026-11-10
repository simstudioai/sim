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
  subscription,
  user,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.BILLING_ENABLED = 'true'
})

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
}
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
