/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckWorkspaceAccess, mockGetUsersWithPermissions, dbState, makeChain, dbMock } =
  vi.hoisted(() => {
    const state = { results: [] as unknown[][] }
    const chainFactory = () => {
      const resolve = () => Promise.resolve(state.results.shift() ?? [])
      const chain: any = {}
      chain.from = vi.fn(() => chain)
      chain.innerJoin = vi.fn(() => chain)
      chain.where = vi.fn(() => chain)
      chain.set = vi.fn(() => chain)
      chain.limit = vi.fn(() => resolve())
      chain.returning = vi.fn(() => resolve())
      chain.then = (onFulfilled: any, onRejected: any) => resolve().then(onFulfilled, onRejected)
      return chain
    }
    return {
      mockCheckWorkspaceAccess: vi.fn(),
      mockGetUsersWithPermissions: vi.fn(),
      dbState: state,
      makeChain: chainFactory,
      dbMock: {
        select: vi.fn(() => chainFactory()),
        update: vi.fn(() => chainFactory()),
      },
    }
  })

vi.mock('@sim/db', () => ({
  db: dbMock,
}))

vi.mock('@sim/db/schema', () => ({
  skill: {
    id: 'skill.id',
    workspaceId: 'skill.workspaceId',
    name: 'skill.name',
  },
  skillMember: {
    id: 'skillMember.id',
    skillId: 'skillMember.skillId',
    userId: 'skillMember.userId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ inArray: [a, b] })),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
  getUsersWithPermissions: mockGetUsersWithPermissions,
  resolveWorkspaceAccess: vi.fn(async (workspaceId: string, userId: string, provided?: any) =>
    provided && provided.workspace?.id === workspaceId
      ? provided
      : mockCheckWorkspaceAccess(workspaceId, userId)
  ),
}))

import {
  checkSkillsUpdateAccess,
  getEditableSkillIds,
  getSkillActorContext,
  listSkillEditors,
  removeWorkspaceSkillMembershipsTx,
} from '@/lib/skills/access'

const wsAdmin = { hasAccess: true, canWrite: true, canAdmin: true, workspace: { id: 'ws' } }
const wsWrite = { hasAccess: true, canWrite: true, canAdmin: false, workspace: { id: 'ws' } }
const wsRead = { hasAccess: true, canWrite: false, canAdmin: false, workspace: { id: 'ws' } }
const wsNone = { hasAccess: false, canWrite: false, canAdmin: false, workspace: null }

beforeEach(() => {
  vi.clearAllMocks()
  dbState.results = []
  mockGetUsersWithPermissions.mockResolvedValue([])
})

describe('getSkillActorContext', () => {
  it('grants edit access from an explicit editor row', async () => {
    dbState.results = [[{ id: 's1', workspaceId: 'ws' }], [{ id: 'row-1' }]]
    mockCheckWorkspaceAccess.mockResolvedValue(wsRead)

    const ctx = await getSkillActorContext('s1', 'user1')

    expect(ctx.hasWorkspaceAccess).toBe(true)
    expect(ctx.canEdit).toBe(true)
  })

  it('derives edit access from workspace admin without any rows', async () => {
    dbState.results = [[{ id: 's1', workspaceId: 'ws' }], []]
    mockCheckWorkspaceAccess.mockResolvedValue(wsAdmin)

    const ctx = await getSkillActorContext('s1', 'admin-user')

    expect(ctx.canEdit).toBe(true)
  })

  it('lets rowless workspace members see but not edit', async () => {
    dbState.results = [[{ id: 's1', workspaceId: 'ws' }], []]
    mockCheckWorkspaceAccess.mockResolvedValue(wsWrite)

    const ctx = await getSkillActorContext('s1', 'writer')

    expect(ctx.hasWorkspaceAccess).toBe(true)
    expect(ctx.canEdit).toBe(false)
  })

  it('denies everything without workspace access, even with an editor row', async () => {
    dbState.results = [[{ id: 's1', workspaceId: 'ws' }], [{ id: 'row-1' }]]
    mockCheckWorkspaceAccess.mockResolvedValue(wsNone)

    const ctx = await getSkillActorContext('s1', 'outsider')

    expect(ctx.hasWorkspaceAccess).toBe(false)
    expect(ctx.canEdit).toBe(false)
  })

  it('returns an empty context when the skill does not exist', async () => {
    dbState.results = [[]]

    const ctx = await getSkillActorContext('missing', 'user1')

    expect(ctx.skill).toBeNull()
    expect(ctx.hasWorkspaceAccess).toBe(false)
    expect(ctx.canEdit).toBe(false)
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })
})

describe('getEditableSkillIds', () => {
  it('collects the editor rows from one workspace-scoped scan', async () => {
    dbState.results = [[{ skillId: 's-mine' }, { skillId: 's-also-mine' }]]
    mockCheckWorkspaceAccess.mockResolvedValue(wsRead)

    const access = await getEditableSkillIds('ws', 'user1')

    expect(access.canAdminWorkspace).toBe(false)
    expect(access.editorSkillIds).toEqual(new Set(['s-mine', 's-also-mine']))
  })

  it('flags workspace admins as editors of everything', async () => {
    dbState.results = [[]]
    mockCheckWorkspaceAccess.mockResolvedValue(wsAdmin)

    const access = await getEditableSkillIds('ws', 'admin-user')

    expect(access.canAdminWorkspace).toBe(true)
  })

  it('grants nothing without workspace access, even with editor rows', async () => {
    dbState.results = [[{ skillId: 's-mine' }]]
    mockCheckWorkspaceAccess.mockResolvedValue(wsNone)

    const access = await getEditableSkillIds('ws', 'outsider')

    expect(access.canAdminWorkspace).toBe(false)
    expect(access.editorSkillIds.size).toBe(0)
  })
})

describe('listSkillEditors', () => {
  const roster = (users: Array<{ userId: string; permissionType: string }>) =>
    users.map((u) => ({
      userId: u.userId,
      permissionType: u.permissionType,
      name: `${u.userId}-name`,
      email: `${u.userId}@x.com`,
      image: null,
    }))

  it('lists derived workspace admins plus explicit editors still in the roster', async () => {
    dbState.results = [
      [
        { id: 'row-1', userId: 'writer' },
        { id: 'row-2', userId: 'ghost' },
      ],
    ]
    mockGetUsersWithPermissions.mockResolvedValue(
      roster([
        { userId: 'boss', permissionType: 'admin' },
        { userId: 'writer', permissionType: 'write' },
        { userId: 'reader', permissionType: 'read' },
      ])
    )

    const editors = await listSkillEditors({ id: 's1', workspaceId: 'ws' })
    const byUser = new Map(editors.map((e) => [e.userId, e]))

    expect(byUser.get('boss')).toMatchObject({
      id: 'workspace-admin-boss',
      isWorkspaceAdmin: true,
      userEmail: 'boss@x.com',
    })
    expect(byUser.get('writer')).toMatchObject({ id: 'row-1', isWorkspaceAdmin: false })
    // Workspace members without a row are not editors.
    expect(byUser.has('reader')).toBe(false)
    // Rows for users no longer in the workspace never render.
    expect(byUser.has('ghost')).toBe(false)
  })

  it('keeps a workspace admin flagged as derived even when they hold an explicit row', async () => {
    dbState.results = [[{ id: 'row-1', userId: 'boss' }]]
    mockGetUsersWithPermissions.mockResolvedValue(
      roster([{ userId: 'boss', permissionType: 'admin' }])
    )

    const editors = await listSkillEditors({ id: 's1', workspaceId: 'ws' })

    expect(editors).toHaveLength(1)
    expect(editors[0]).toMatchObject({ id: 'row-1', userId: 'boss', isWorkspaceAdmin: true })
  })
})

describe('checkSkillsUpdateAccess', () => {
  it('returns nothing for an empty id list without querying', async () => {
    const result = await checkSkillsUpdateAccess({ workspaceId: 'ws', userId: 'u', skillIds: [] })
    expect(result.existingIds.size).toBe(0)
    expect(result.denied).toEqual([])
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it('partitions resolvable ids and denies skills without an editor row', async () => {
    dbState.results = [
      [
        { id: 's-mine', name: 'mine' },
        { id: 's-other', name: 'other' },
      ],
      [{ skillId: 's-mine' }],
    ]
    mockCheckWorkspaceAccess.mockResolvedValue(wsWrite)

    const result = await checkSkillsUpdateAccess({
      workspaceId: 'ws',
      userId: 'u',
      skillIds: ['s-mine', 's-other', 's-create'],
    })

    expect(result.existingIds).toEqual(new Set(['s-mine', 's-other']))
    expect(result.denied).toEqual([{ id: 's-other', name: 'other' }])
  })

  it('denies nothing for workspace admins', async () => {
    dbState.results = [[{ id: 's-any', name: 'any' }], []]
    mockCheckWorkspaceAccess.mockResolvedValue(wsAdmin)

    const result = await checkSkillsUpdateAccess({
      workspaceId: 'ws',
      userId: 'admin-user',
      skillIds: ['s-any'],
    })

    expect(result.denied).toEqual([])
  })
})

describe('removeWorkspaceSkillMembershipsTx', () => {
  it('returns 0 for an empty workspace list without querying', async () => {
    const tx = { select: vi.fn(() => makeChain()), delete: vi.fn(() => makeChain()) }
    expect(await removeWorkspaceSkillMembershipsTx(tx as never, [], 'u')).toBe(0)
    expect(tx.delete).not.toHaveBeenCalled()
  })

  it('deletes every editor grant for the user in the workspaces and counts them', async () => {
    const { eq } = await import('drizzle-orm')
    dbState.results = [[{ id: 'm1' }, { id: 'm2' }]]
    const tx = { select: vi.fn(() => makeChain()), delete: vi.fn(() => makeChain()) }

    expect(await removeWorkspaceSkillMembershipsTx(tx as never, ['ws'], 'u')).toBe(2)
    expect(tx.delete).toHaveBeenCalledTimes(1)
    // Rows are plain editor grants — the delete has no status filter, so a
    // re-invited user starts with no edit rights until re-added.
    expect(vi.mocked(eq).mock.calls).toContainEqual(['skillMember.userId', 'u'])
    expect(vi.mocked(eq).mock.calls.some(([field]) => field === 'skillMember.status')).toBe(false)
  })
})
