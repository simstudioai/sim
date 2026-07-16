/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { orderByMock, getSkillAccessForUserMock, resolveSkillRoleFromAccessMock } = vi.hoisted(
  () => ({
    orderByMock: vi.fn(),
    getSkillAccessForUserMock: vi.fn(),
    resolveSkillRoleFromAccessMock: vi.fn(),
  })
)

vi.mock('@sim/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: orderByMock }) }) }) },
}))
vi.mock('@sim/db/schema', () => ({
  skill: { workspaceId: 'workspaceId', name: 'name', createdAt: 'createdAt' },
  skillMember: { skillId: 'skillId', userId: 'userId', role: 'role', status: 'status' },
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@sim/utils/id', () => ({ generateId: () => 'gen-uuid', generateShortId: () => 'gen-id' }))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'req-id' }))
vi.mock('@/lib/skills/access', () => ({
  getSkillAccessForUser: getSkillAccessForUserMock,
  resolveSkillRoleFromAccess: resolveSkillRoleFromAccessMock,
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
}))

import { listSkills, listSkillsForUser } from './operations'

describe('listSkills includeBuiltins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prepends builtin template skills by default', async () => {
    orderByMock.mockResolvedValue([])
    const result = await listSkills({ workspaceId: 'ws-1' })
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((s) => s.id.startsWith('builtin-'))).toBe(true)
  })

  // The mothership skill inventory passes includeBuiltins: false so it never sees
  // the code-only template skills.
  it('excludes builtin template skills when includeBuiltins is false', async () => {
    orderByMock.mockResolvedValue([
      { id: 'sk-1', name: 'mine', description: 'd', content: 'c', workspaceId: 'ws-1' },
    ])
    const result = await listSkills({ workspaceId: 'ws-1', includeBuiltins: false })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sk-1')
    expect(result.some((s) => s.id.startsWith('builtin-'))).toBe(false)
  })
})

describe('listSkillsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSkillAccessForUserMock.mockResolvedValue({
      hasWorkspaceAccess: true,
      canAdminWorkspace: false,
      membershipBySkillId: new Map(),
    })
  })

  it('filters out skills the user has no role on and tags the rest', async () => {
    orderByMock.mockResolvedValue([
      { id: 'sk-mine', name: 'mine', description: 'd', content: 'c', workspaceId: 'ws-1' },
      { id: 'sk-hidden', name: 'hidden', description: 'd', content: 'c', workspaceId: 'ws-1' },
    ])
    resolveSkillRoleFromAccessMock.mockImplementation((row: { id: string }) =>
      row.id === 'sk-mine' ? 'admin' : null
    )

    const result = await listSkillsForUser({
      workspaceId: 'ws-1',
      userId: 'user-1',
      includeBuiltins: false,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'sk-mine', role: 'admin' })
  })

  it('always passes builtin skills through with a null role', async () => {
    orderByMock.mockResolvedValue([])
    resolveSkillRoleFromAccessMock.mockReturnValue(null)

    const result = await listSkillsForUser({ workspaceId: 'ws-1', userId: 'user-1' })

    expect(result.length).toBeGreaterThan(0)
    expect(result.every((s) => s.id.startsWith('builtin-') && s.role === null)).toBe(true)
  })

  it('dedups a builtin only against rows the caller can see, so a restricted override never hides it from non-members', async () => {
    const override = {
      id: 'sk-research',
      name: 'research',
      description: 'd',
      content: 'c',
      workspaceId: 'ws-1',
      workspaceShared: false,
    }
    orderByMock.mockResolvedValue([override])

    resolveSkillRoleFromAccessMock.mockReturnValue(null)
    const nonMember = await listSkillsForUser({ workspaceId: 'ws-1', userId: 'outsider' })
    expect(nonMember.some((s) => s.id === 'builtin-research')).toBe(true)
    expect(nonMember.some((s) => s.id === 'sk-research')).toBe(false)

    resolveSkillRoleFromAccessMock.mockReturnValue('member')
    const member = await listSkillsForUser({ workspaceId: 'ws-1', userId: 'member' })
    expect(member.some((s) => s.id === 'builtin-research')).toBe(false)
    expect(member.some((s) => s.id === 'sk-research')).toBe(true)
  })
})
