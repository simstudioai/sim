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
    workspaceShared: 'skill.workspaceShared',
    name: 'skill.name',
  },
  skillMember: {
    id: 'skillMember.id',
    skillId: 'skillMember.skillId',
    userId: 'skillMember.userId',
    status: 'skillMember.status',
    role: 'skillMember.role',
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
  canUseSkill,
  checkSkillsUpdateAccess,
  getSkillAccessForUser,
  getSkillActorContext,
  listSkillMembers,
  removeWorkspaceSkillMembershipsTx,
  resolveSkillRole,
  resolveSkillRoleFromAccess,
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

describe('resolveSkillRole', () => {
  it('denies everything without workspace access, even with an explicit admin row', () => {
    expect(
      resolveSkillRole({
        workspaceShared: true,
        memberRole: 'admin',
        memberStatus: 'active',
        workspaceAccess: wsNone,
      })
    ).toBeNull()
  })

  it('resolves workspace admins to admin regardless of rows', () => {
    expect(
      resolveSkillRole({
        workspaceShared: false,
        memberRole: 'member',
        memberStatus: 'revoked',
        workspaceAccess: wsAdmin,
      })
    ).toBe('admin')
  })

  it('resolves an active explicit row to its role', () => {
    expect(
      resolveSkillRole({
        workspaceShared: false,
        memberRole: 'admin',
        memberStatus: 'active',
        workspaceAccess: wsRead,
      })
    ).toBe('admin')
  })

  it('treats a revoked row as a deny even when the skill is workspace-shared', () => {
    expect(
      resolveSkillRole({
        workspaceShared: true,
        memberRole: 'member',
        memberStatus: 'revoked',
        workspaceAccess: wsWrite,
      })
    ).toBeNull()
  })

  it('grants implicit member access to workspace members while shared', () => {
    expect(
      resolveSkillRole({
        workspaceShared: true,
        memberRole: null,
        memberStatus: null,
        workspaceAccess: wsRead,
      })
    ).toBe('member')
  })

  it('denies rowless workspace members when the skill is not shared', () => {
    expect(
      resolveSkillRole({
        workspaceShared: false,
        memberRole: null,
        memberStatus: null,
        workspaceAccess: wsWrite,
      })
    ).toBeNull()
  })
})

describe('getSkillActorContext', () => {
  it('treats an explicit skill admin membership as admin', async () => {
    dbState.results = [
      [{ id: 's1', workspaceId: 'ws', workspaceShared: true }],
      [{ role: 'admin', status: 'active' }],
    ]
    mockCheckWorkspaceAccess.mockResolvedValue(wsWrite)

    const ctx = await getSkillActorContext('s1', 'user1')

    expect(ctx.role).toBe('admin')
  })

  it('derives skill admin from workspace admin without any rows', async () => {
    dbState.results = [[{ id: 's1', workspaceId: 'ws', workspaceShared: false }], []]
    mockCheckWorkspaceAccess.mockResolvedValue(wsAdmin)

    const ctx = await getSkillActorContext('s1', 'admin-user')

    expect(ctx.role).toBe('admin')
  })

  it('resolves implicit member access for a rowless workspace member on a shared skill', async () => {
    dbState.results = [[{ id: 's1', workspaceId: 'ws', workspaceShared: true }], []]
    mockCheckWorkspaceAccess.mockResolvedValue(wsRead)

    const ctx = await getSkillActorContext('s1', 'reader')

    expect(ctx.role).toBe('member')
  })

  it('denies a revoked member even on a shared skill', async () => {
    dbState.results = [
      [{ id: 's1', workspaceId: 'ws', workspaceShared: true }],
      [{ role: 'member', status: 'revoked' }],
    ]
    mockCheckWorkspaceAccess.mockResolvedValue(wsWrite)

    const ctx = await getSkillActorContext('s1', 'revoked-user')

    expect(ctx.role).toBeNull()
  })

  it('denies rowless members on a restricted skill', async () => {
    dbState.results = [[{ id: 's1', workspaceId: 'ws', workspaceShared: false }], []]
    mockCheckWorkspaceAccess.mockResolvedValue(wsWrite)

    const ctx = await getSkillActorContext('s1', 'writer')

    expect(ctx.role).toBeNull()
  })

  it('returns an empty context when the skill does not exist', async () => {
    dbState.results = [[]]

    const ctx = await getSkillActorContext('missing', 'user1')

    expect(ctx.skill).toBeNull()
    expect(ctx.role).toBeNull()
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('reuses a provided workspace access when it matches the skill workspace', async () => {
    dbState.results = [
      [{ id: 's1', workspaceId: 'ws', workspaceShared: true }],
      [{ role: 'member', status: 'active' }],
    ]

    const ctx = await getSkillActorContext('s1', 'user1', { workspaceAccess: wsWrite as never })

    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(ctx.role).toBe('member')
  })
})

describe('getSkillAccessForUser + resolveSkillRoleFromAccess', () => {
  it('evaluates roles from one membership scan', async () => {
    dbState.results = [
      [
        { skillId: 's-admin', role: 'admin', status: 'active' },
        { skillId: 's-revoked', role: 'member', status: 'revoked' },
      ],
    ]
    mockCheckWorkspaceAccess.mockResolvedValue(wsRead)

    const access = await getSkillAccessForUser('ws', 'user1')

    expect(resolveSkillRoleFromAccess({ id: 's-admin', workspaceShared: false }, access)).toBe(
      'admin'
    )
    expect(resolveSkillRoleFromAccess({ id: 's-revoked', workspaceShared: true }, access)).toBeNull()
    expect(resolveSkillRoleFromAccess({ id: 's-shared', workspaceShared: true }, access)).toBe(
      'member'
    )
    expect(
      resolveSkillRoleFromAccess({ id: 's-restricted', workspaceShared: false }, access)
    ).toBeNull()
    expect(canUseSkill({ id: 's-shared', workspaceShared: true }, access)).toBe(true)
    expect(canUseSkill({ id: 's-revoked', workspaceShared: true }, access)).toBe(false)
  })

  it('resolves everything to admin for workspace admins', async () => {
    dbState.results = [[]]
    mockCheckWorkspaceAccess.mockResolvedValue(wsAdmin)

    const access = await getSkillAccessForUser('ws', 'admin-user')

    expect(resolveSkillRoleFromAccess({ id: 'any', workspaceShared: false }, access)).toBe('admin')
  })
})

describe('checkSkillsUpdateAccess', () => {
  it('returns nothing for an empty id list without querying', async () => {
    const result = await checkSkillsUpdateAccess({ workspaceId: 'ws', userId: 'u', skillIds: [] })
    expect(result.existingIds.size).toBe(0)
    expect(result.denied).toEqual([])
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it('partitions resolvable ids and reports denied skills with their role', async () => {
    dbState.results = [
      [
        { id: 's-mine', name: 'mine', workspaceShared: true },
        { id: 's-other', name: 'other', workspaceShared: true },
        { id: 's-hidden', name: 'hidden', workspaceShared: false },
      ],
      [{ skillId: 's-mine', role: 'admin', status: 'active' }],
    ]
    mockCheckWorkspaceAccess.mockResolvedValue(wsWrite)

    const result = await checkSkillsUpdateAccess({
      workspaceId: 'ws',
      userId: 'u',
      skillIds: ['s-mine', 's-other', 's-hidden', 's-create'],
    })

    expect(result.existingIds).toEqual(new Set(['s-mine', 's-other', 's-hidden']))
    expect(result.denied).toEqual([
      { id: 's-other', name: 'other', role: 'member' },
      { id: 's-hidden', name: 'hidden', role: null },
    ])
  })
})

describe('removeWorkspaceSkillMembershipsTx', () => {
  it('returns 0 for an empty workspace list without querying', async () => {
    const tx = { select: vi.fn(() => makeChain()), delete: vi.fn(() => makeChain()) }
    expect(await removeWorkspaceSkillMembershipsTx(tx as never, [], 'u')).toBe(0)
    expect(tx.delete).not.toHaveBeenCalled()
  })

  it('deletes only active grants (deny markers survive) and counts them', async () => {
    const { eq } = await import('drizzle-orm')
    dbState.results = [[{ id: 'm1' }, { id: 'm2' }]]
    const tx = { select: vi.fn(() => makeChain()), delete: vi.fn(() => makeChain()) }

    expect(await removeWorkspaceSkillMembershipsTx(tx as never, ['ws'], 'u')).toBe(2)
    expect(tx.delete).toHaveBeenCalledTimes(1)
    // The delete is scoped to status='active' so revoked per-skill deny
    // markers persist across leave/rejoin.
    expect(vi.mocked(eq).mock.calls).toContainEqual(['skillMember.status', 'active'])
  })
})

describe('listSkillMembers', () => {
  const roster = (users: Array<{ userId: string; permissionType: string }>) =>
    users.map((u) => ({
      userId: u.userId,
      permissionType: u.permissionType,
      name: `${u.userId}-name`,
      email: `${u.userId}@x.com`,
      image: null,
    }))

  it('maps the current roster through resolveSkillRole with derived admins, explicit roles, and implicit members', async () => {
    dbState.results = [
      [
        { id: 'row-1', userId: 'writer', role: 'admin', status: 'active', joinedAt: null },
        { id: 'row-2', userId: 'denied', role: 'member', status: 'revoked', joinedAt: null },
        { id: 'row-3', userId: 'ghost', role: 'admin', status: 'active', joinedAt: null },
      ],
    ]
    mockGetUsersWithPermissions.mockResolvedValue(
      roster([
        { userId: 'boss', permissionType: 'admin' },
        { userId: 'writer', permissionType: 'write' },
        { userId: 'denied', permissionType: 'write' },
        { userId: 'reader', permissionType: 'read' },
      ])
    )

    const entries = await listSkillMembers({ id: 's1', workspaceId: 'ws', workspaceShared: true })
    const byUser = new Map(entries.map((e) => [e.userId, e]))

    expect(byUser.get('boss')).toMatchObject({
      role: 'admin',
      status: 'active',
      roleSource: 'workspace-admin',
    })
    expect(byUser.get('writer')).toMatchObject({
      role: 'admin',
      status: 'active',
      roleSource: 'explicit',
    })
    // A deny marker stays visible as a removed entry so admins can restore it.
    expect(byUser.get('denied')).toMatchObject({ status: 'revoked', roleSource: 'explicit' })
    expect(byUser.get('reader')).toMatchObject({
      role: 'member',
      status: 'active',
      roleSource: 'workspace',
    })
    // Explicit rows for users no longer in the workspace never render.
    expect(byUser.has('ghost')).toBe(false)
  })

  it('omits rowless members on a restricted skill and keeps derived admins over revoked rows', async () => {
    dbState.results = [
      [{ id: 'row-1', userId: 'boss', role: 'member', status: 'revoked', joinedAt: null }],
    ]
    mockGetUsersWithPermissions.mockResolvedValue(
      roster([
        { userId: 'boss', permissionType: 'admin' },
        { userId: 'reader', permissionType: 'read' },
      ])
    )

    const entries = await listSkillMembers({ id: 's1', workspaceId: 'ws', workspaceShared: false })

    // Derived access can never be broken by explicit rows: the workspace admin
    // stays an active admin even with a stale revoked row.
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      userId: 'boss',
      role: 'admin',
      status: 'active',
      roleSource: 'workspace-admin',
    })
  })
})
