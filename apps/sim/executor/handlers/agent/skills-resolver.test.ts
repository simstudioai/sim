/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbState, getSkillAccessForUserMock, canUseSkillMock } = vi.hoisted(() => ({
  dbState: { results: [] as unknown[][] },
  getSkillAccessForUserMock: vi.fn(),
  canUseSkillMock: vi.fn(),
}))

vi.mock('@sim/db', () => {
  const makeChain = () => {
    const resolve = () => Promise.resolve(dbState.results.shift() ?? [])
    const chain: any = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    chain.limit = vi.fn(() => resolve())
    chain.then = (onFulfilled: any, onRejected: any) => resolve().then(onFulfilled, onRejected)
    return chain
  }
  return {
    db: { select: () => makeChain() },
    skill: {
      id: 'id',
      workspaceId: 'workspaceId',
      name: 'name',
      description: 'description',
      content: 'content',
      workspaceShared: 'workspaceShared',
    },
  }
})
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
}))
vi.mock('@/lib/skills/access', () => ({
  getSkillAccessForUser: getSkillAccessForUserMock,
  canUseSkill: canUseSkillMock,
}))

import {
  resolveSkillContent,
  resolveSkillContentById,
  resolveSkillMetadata,
  SkillAccessDeniedError,
} from './skills-resolver'

const ENFORCED = { userId: 'user-1', enforce: true }

// resolveSkillContent is the shared resolver invoked when a workflow agent
// block calls load_skill.
beforeEach(() => {
  vi.clearAllMocks()
  dbState.results = []
  getSkillAccessForUserMock.mockResolvedValue({
    hasWorkspaceAccess: true,
    canAdminWorkspace: false,
    membershipBySkillId: new Map(),
  })
  canUseSkillMock.mockReturnValue(true)
})

describe('resolveSkillContent', () => {
  it('returns null without a skill name or workspace', async () => {
    expect(await resolveSkillContent('', 'ws-1')).toBeNull()
    expect(await resolveSkillContent('x', '')).toBeNull()
  })

  it('resolves builtin skills without touching the database or access rules', async () => {
    const content = await resolveSkillContent('research', 'ws-1', ENFORCED)
    expect(content).toBeTruthy()
    expect(getSkillAccessForUserMock).not.toHaveBeenCalled()
  })

  it('resolves a workspace user skill by name', async () => {
    dbState.results = [
      [{ id: 'sk-1', content: '# Playbook', name: 'posthog-playbook', workspaceShared: true }],
    ]
    expect(await resolveSkillContent('posthog-playbook', 'ws-1')).toBe('# Playbook')
    expect(getSkillAccessForUserMock).not.toHaveBeenCalled()
  })

  it('returns null when the user skill is not found', async () => {
    dbState.results = [[]]
    expect(await resolveSkillContent('missing', 'ws-1')).toBeNull()
  })

  it('returns content when the enforced actor has access', async () => {
    dbState.results = [
      [{ id: 'sk-1', content: '# Playbook', name: 'posthog-playbook', workspaceShared: true }],
    ]
    expect(await resolveSkillContent('posthog-playbook', 'ws-1', ENFORCED)).toBe('# Playbook')
    expect(getSkillAccessForUserMock).toHaveBeenCalledWith('ws-1', 'user-1')
  })

  it('throws SkillAccessDeniedError when the enforced actor lacks access', async () => {
    dbState.results = [
      [{ id: 'sk-1', content: '# Playbook', name: 'posthog-playbook', workspaceShared: false }],
    ]
    canUseSkillMock.mockReturnValue(false)

    await expect(resolveSkillContent('posthog-playbook', 'ws-1', ENFORCED)).rejects.toThrow(
      'You do not have access to skill "posthog-playbook"'
    )
  })

  it('does not enforce when the actor is not marked enforce', async () => {
    dbState.results = [
      [{ id: 'sk-1', content: '# Playbook', name: 'posthog-playbook', workspaceShared: false }],
    ]
    canUseSkillMock.mockReturnValue(false)

    expect(await resolveSkillContent('posthog-playbook', 'ws-1', { userId: 'user-1' })).toBe(
      '# Playbook'
    )
    expect(getSkillAccessForUserMock).not.toHaveBeenCalled()
  })
})

describe('resolveSkillContentById', () => {
  it('resolves a workspace skill by id under enforcement', async () => {
    dbState.results = [[{ id: 'sk-1', content: '# Body', name: 'my-skill', workspaceShared: true }]]
    expect(await resolveSkillContentById('sk-1', 'ws-1', ENFORCED)).toEqual({
      name: 'my-skill',
      content: '# Body',
    })
  })

  it('throws SkillAccessDeniedError for an inaccessible skill', async () => {
    dbState.results = [
      [{ id: 'sk-1', content: '# Body', name: 'my-skill', workspaceShared: false }],
    ]
    canUseSkillMock.mockReturnValue(false)

    await expect(resolveSkillContentById('sk-1', 'ws-1', ENFORCED)).rejects.toBeInstanceOf(
      SkillAccessDeniedError
    )
  })
})

describe('resolveSkillMetadata', () => {
  it('returns all attached skills when not enforcing', async () => {
    dbState.results = [
      [
        { id: 'sk-1', name: 'a', description: 'A', workspaceShared: true },
        { id: 'sk-2', name: 'b', description: 'B', workspaceShared: false },
      ],
    ]

    const metadata = await resolveSkillMetadata([{ skillId: 'sk-1' }, { skillId: 'sk-2' }], 'ws-1')

    expect(metadata.map((m) => m.name)).toEqual(['a', 'b'])
    expect(getSkillAccessForUserMock).not.toHaveBeenCalled()
  })

  it('filters skills the enforced actor cannot access', async () => {
    dbState.results = [
      [
        { id: 'sk-1', name: 'a', description: 'A', workspaceShared: true },
        { id: 'sk-2', name: 'b', description: 'B', workspaceShared: false },
      ],
    ]
    canUseSkillMock.mockImplementation((row: { id: string }) => row.id !== 'sk-2')

    const metadata = await resolveSkillMetadata(
      [{ skillId: 'sk-1' }, { skillId: 'sk-2' }],
      'ws-1',
      ENFORCED
    )

    expect(metadata.map((m) => m.name)).toEqual(['a'])
  })
})
