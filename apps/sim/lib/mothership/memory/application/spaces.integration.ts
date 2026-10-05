import { db } from '@sim/db'
import {
  copilotChats,
  member,
  mothershipBenchmarks,
  mothershipMemorySelections,
  mothershipMemorySpaces,
  organization,
  permissions,
  settings,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { createWorkspaceChat } from '@/lib/mothership/chat/application/create-workspace-chat'
import { forkChat } from '@/lib/mothership/chat/application/fork'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  createOrganizationChat,
  createOrganizationChatRecord,
} from '@/lib/mothership/chat/organization-chats'
import {
  MEMORY_SCOPE_AUDIENCE,
  readMemoryScope,
} from '@/lib/mothership/memory/application/read-scope'
import {
  createMemorySpace,
  listMemorySpaces,
  selectMemorySpace,
} from '@/lib/mothership/memory/application/spaces'

vi.hoisted(() => {
  process.env.MOTHERSHIP_BENCHMARK_ENABLED = 'true'
})
/** The worker conversation copy is a separate service; Sim persistence and authorization stay real. */
vi.mock('@/lib/mothership/chat/fork-worker', () => ({ copyWorkerConversation: async () => {} }))

const ids = {
  owner: generateId(),
  other: generateId(),
  outsider: generateId(),
  regular: generateId(),
  org: generateId(),
  secondOrg: generateId(),
  workspace: generateId(),
  secondWorkspace: generateId(),
}
const principal = (userId = ids.owner) => ({
  kind: 'session' as const,
  userId,
  sessionId: 'kg-integration-session',
})
const input = { organizationId: ids.org }
const create = (name: string) =>
  createMemorySpace.execute({ principal: principal(), input: { ...input, name } })
const select = (spaceId: string | null) =>
  selectMemorySpace.execute({ principal: principal(), input: { ...input, spaceId } })
const list = () => listMemorySpaces.execute({ principal: principal(), input })
async function scope(chatId: string, workspaceId?: string, userId = ids.owner) {
  const options = { audience: MEMORY_SCOPE_AUDIENCE, ttlMs: 60_000 }
  const caller = workspaceId
    ? createTrustedCopilotPrincipal(
        { userId, workspaceId, chatId, delegationId: generateId() },
        options
      )
    : createTrustedOrganizationCopilotPrincipal(
        { userId, organizationId: ids.org, chatId, delegationId: generateId() },
        options
      )
  return readMemoryScope.execute({
    principal: caller,
    input: { chatId },
  })
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ids.owner, ids.other, ids.outsider, ids.regular].map((id) => ({
      id,
      name: 'KG fixture',
      role: id === ids.owner || id === ids.other ? 'admin' : 'user',
      email: `${id}@fixture.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(settings).values(
    [ids.owner, ids.other, ids.regular].map((userId) => ({
      id: generateId(),
      userId,
      superUserModeEnabled: true,
    }))
  )
  await db
    .insert(organization)
    .values(
      [ids.org, ids.secondOrg].map((id) => ({ id, name: 'KG fixture organization', slug: id }))
    )
  await db.insert(member).values([
    { id: generateId(), organizationId: ids.org, userId: ids.owner, role: 'member' },
    { id: generateId(), organizationId: ids.org, userId: ids.other, role: 'admin' },
    { id: generateId(), organizationId: ids.org, userId: ids.regular, role: 'admin' },
  ])
  await db.insert(workspace).values(
    [ids.workspace, ids.secondWorkspace].map((id) => ({
      id,
      name: 'KG fixture workspace',
      organizationId: ids.org,
      ownerId: ids.owner,
      billedAccountUserId: ids.owner,
    }))
  )
  await db.insert(permissions).values(
    [ids.workspace, ids.secondWorkspace].map((entityId) => ({
      id: generateId(),
      userId: ids.owner,
      entityId,
      entityType: 'workspace' as const,
      permissionType: 'admin' as const,
    }))
  )
})
afterAll(async () => {
  await db.delete(organization).where(inArray(organization.id, [ids.org, ids.secondOrg]))
  await db.delete(user).where(inArray(user.id, [ids.owner, ids.other, ids.outsider, ids.regular]))
})

describe('private KG selection through authorized application boundaries', () => {
  it('rejects an organization admin without platform super-user access at every public entry', async () => {
    const caller = principal(ids.regular)
    await expect(
      createOrganizationChat.execute({ principal: caller, input: { ...input, mode: 'plan' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(listMemorySpaces.execute({ principal: caller, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(
      createMemorySpace.execute({ principal: caller, input: { ...input, name: 'Forbidden' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      selectMemorySpace.execute({ principal: caller, input: { ...input, spaceId: null } })
    ).rejects.toMatchObject({ code: 'not_found' })
    const chat = await createOrganizationChat.execute({
      principal: caller,
      input: { ...input, mode: 'agent' },
    })
    expect(await scope(chat.id, undefined, ids.regular)).toMatchObject({
      enabled: false,
      userId: ids.regular,
    })
  })

  it('does not grant an ineligible user access through a benchmark operator', async () => {
    const benchmarkId = generateId()
    await db.insert(mothershipBenchmarks).values({
      id: benchmarkId,
      organizationId: ids.org,
      userId: ids.owner,
      runAsUserId: ids.regular,
      sourceWorkspaceId: ids.workspace,
      name: 'Synthetic scope fixture',
      artifacts: {},
    })
    const chat = await createOrganizationChatRecord(
      { userId: ids.regular, organizationId: ids.org },
      'plan',
      { id: benchmarkId, operatorUserId: ids.owner }
    )
    expect(await scope(chat.id, undefined, ids.regular)).toMatchObject({
      enabled: false,
      userId: ids.regular,
    })
  })

  it('keeps Default implicit and rolls back an invalid first creation', async () => {
    expect(await list()).toEqual({ spaces: [{ id: null, name: 'Default' }], activeSpaceId: null })
    await expect(create('  Default  ')).rejects.toMatchObject({ code: 'validation' })
    expect(
      await db
        .select()
        .from(mothershipMemorySelections)
        .where(eq(mothershipMemorySelections.userId, ids.owner))
    ).toHaveLength(0)
  })

  it('keeps old chats and forks on their original graph while new chats across workspaces use the selection', async () => {
    const original = await createOrganizationChat.execute({
      principal: principal(),
      input: { ...input, mode: 'plan' },
    })
    expect((await scope(original.id)).spaceId).toBeUndefined()
    const selected = await create('First exploration')
    expect(selected.activeSpaceId).not.toBeNull()
    const next = await createOrganizationChat.execute({
      principal: principal(),
      input: { ...input, mode: 'plan' },
    })
    expect((await scope(next.id)).spaceId).toBe(selected.activeSpaceId)
    for (const workspaceId of [ids.workspace, ids.secondWorkspace]) {
      const chat = await createWorkspaceChat.execute({
        principal: principal(),
        input: { workspaceId, mode: 'plan' },
      })
      expect((await scope(chat.id, workspaceId)).spaceId).toBe(selected.activeSpaceId)
    }
    await create('Second exploration')
    expect((await scope(original.id)).spaceId).toBeUndefined()
    expect((await scope(next.id)).spaceId).toBe(selected.activeSpaceId)
    const messageId = generateId()
    await appendCopilotChatMessages(next.id, [
      {
        id: messageId,
        role: 'user',
        content: 'Private fixture',
        timestamp: new Date().toISOString(),
      },
    ])
    const fork = await forkChat.execute({
      principal: principal(),
      input: { chatId: next.id, upToMessageId: messageId },
    })
    expect((await scope(fork.id)).spaceId).toBe(selected.activeSpaceId)
    await select(null)
    const reset = await createOrganizationChat.execute({
      principal: principal(),
      input: { ...input, mode: 'plan' },
    })
    expect((await scope(reset.id)).spaceId).toBeUndefined()
    expect((await list()).spaces).toHaveLength(3)
  })

  it('conceals other members’ spaces even from admins and refuses cross-organization selection', async () => {
    const selected = await create('Private fixture')
    expect(await listMemorySpaces.execute({ principal: principal(ids.other), input })).toEqual({
      spaces: [{ id: null, name: 'Default' }],
      activeSpaceId: null,
    })
    await expect(
      selectMemorySpace.execute({
        principal: principal(ids.other),
        input: { ...input, spaceId: selected.activeSpaceId },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await db
      .update(member)
      .set({ organizationId: ids.secondOrg })
      .where(eq(member.userId, ids.owner))
    try {
      await expect(
        selectMemorySpace.execute({
          principal: principal(),
          input: { organizationId: ids.secondOrg, spaceId: selected.activeSpaceId },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    } finally {
      await db.update(member).set({ organizationId: ids.org }).where(eq(member.userId, ids.owner))
    }
    expect((await list()).activeSpaceId).toBe(selected.activeSpaceId)
    await expect(
      listMemorySpaces.execute({ principal: principal(ids.outsider), input })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('serializes concurrent create-and-select operations without losing graphs', async () => {
    const before = await list()
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) => create(`Concurrent ${index}`))
    )
    const after = await list()
    expect(after.spaces).toHaveLength(before.spaces.length + created.length)
    expect(created.map((row) => row.activeSpaceId)).toContain(after.activeSpaceId)
    expect(
      await db
        .select()
        .from(mothershipMemorySelections)
        .where(
          and(
            eq(mothershipMemorySelections.userId, ids.owner),
            eq(mothershipMemorySelections.organizationId, ids.org)
          )
        )
    ).toHaveLength(1)
    for (const row of created)
      expect(after.spaces.some((space) => space.id === row.activeSpaceId)).toBe(true)
  })

  it('disabling Graphiti preserves bound graphs for reactivation and makes new chats use Default', async () => {
    const selected = await create('Flag lifecycle')
    const chat = await createOrganizationChat.execute({
      principal: principal(),
      input: { ...input, mode: 'plan' },
    })
    await db
      .update(settings)
      .set({ superUserModeEnabled: false })
      .where(eq(settings.userId, ids.owner))
    try {
      await expect(list()).rejects.toMatchObject({ code: 'not_found' })
      await expect(create('Hidden')).rejects.toMatchObject({ code: 'not_found' })
      await expect(select(null)).rejects.toMatchObject({ code: 'not_found' })
      expect(await scope(chat.id)).toMatchObject({
        enabled: false,
        spaceId: selected.activeSpaceId,
      })
      await expect(
        createOrganizationChat.execute({
          principal: principal(),
          input: { ...input, mode: 'plan' },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      const next = await createOrganizationChat.execute({
        principal: principal(),
        input: { ...input, mode: 'agent' },
      })
      expect((await scope(next.id)).spaceId).toBeUndefined()
    } finally {
      await db
        .update(settings)
        .set({ superUserModeEnabled: true })
        .where(eq(settings.userId, ids.owner))
    }
    expect(await scope(chat.id)).toMatchObject({ enabled: true, spaceId: selected.activeSpaceId })
    expect((await list()).spaces).toContainEqual({
      id: selected.activeSpaceId,
      name: 'Flag lifecycle',
    })
  })

  it('rejects a foreign binding and rechecks membership before reading memory', async () => {
    const foreign = await createMemorySpace.execute({
      principal: principal(ids.other),
      input: { ...input, name: 'Foreign' },
    })
    const chat = await createOrganizationChat.execute({
      principal: principal(),
      input: { ...input, mode: 'plan' },
    })
    await db
      .update(copilotChats)
      .set({ memorySpaceId: foreign.activeSpaceId })
      .where(eq(copilotChats.id, chat.id))
    await expect(scope(chat.id)).rejects.toMatchObject({ code: 'not_found' })
    const [owned] = await db
      .select()
      .from(mothershipMemorySpaces)
      .where(eq(mothershipMemorySpaces.userId, ids.owner))
      .limit(1)
    await db
      .update(copilotChats)
      .set({ memorySpaceId: owned.id })
      .where(eq(copilotChats.id, chat.id))
    await db
      .delete(member)
      .where(and(eq(member.userId, ids.owner), eq(member.organizationId, ids.org)))
    await expect(scope(chat.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(list()).rejects.toMatchObject({ code: 'not_found' })
  })
})
