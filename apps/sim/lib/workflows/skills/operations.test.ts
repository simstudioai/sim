/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { orderByMock, getEditableSkillIdsMock } = vi.hoisted(() => ({
  orderByMock: vi.fn(),
  getEditableSkillIdsMock: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: orderByMock }) }) }) },
}))
vi.mock('@sim/db/schema', () => ({
  skill: { workspaceId: 'workspaceId', name: 'name', createdAt: 'createdAt' },
  skillMember: { skillId: 'skillId', userId: 'userId' },
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@sim/utils/id', () => ({ generateId: () => 'gen-uuid', generateShortId: () => 'gen-id' }))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'req-id' }))
vi.mock('@/lib/skills/access', () => ({
  getEditableSkillIds: getEditableSkillIdsMock,
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
    getEditableSkillIdsMock.mockResolvedValue({
      canAdminWorkspace: false,
      editorSkillIds: new Set(),
    })
  })

  it('returns every workspace skill tagged with edit access from editor rows', async () => {
    orderByMock.mockResolvedValue([
      { id: 'sk-mine', name: 'mine', description: 'd', content: 'c', workspaceId: 'ws-1' },
      { id: 'sk-other', name: 'other', description: 'd', content: 'c', workspaceId: 'ws-1' },
    ])
    getEditableSkillIdsMock.mockResolvedValue({
      canAdminWorkspace: false,
      editorSkillIds: new Set(['sk-mine']),
    })

    const result = await listSkillsForUser({
      workspaceId: 'ws-1',
      userId: 'user-1',
      includeBuiltins: false,
    })

    expect(result).toHaveLength(2)
    expect(result.find((s) => s.id === 'sk-mine')).toMatchObject({ canEdit: true })
    expect(result.find((s) => s.id === 'sk-other')).toMatchObject({ canEdit: false })
  })

  it('tags every skill editable for workspace admins', async () => {
    orderByMock.mockResolvedValue([
      { id: 'sk-1', name: 'one', description: 'd', content: 'c', workspaceId: 'ws-1' },
      { id: 'sk-2', name: 'two', description: 'd', content: 'c', workspaceId: 'ws-1' },
    ])
    getEditableSkillIdsMock.mockResolvedValue({
      canAdminWorkspace: true,
      editorSkillIds: new Set(),
    })

    const result = await listSkillsForUser({
      workspaceId: 'ws-1',
      userId: 'admin-1',
      includeBuiltins: false,
    })

    expect(result.every((s) => s.canEdit)).toBe(true)
  })

  it('always passes builtin skills through as non-editable', async () => {
    orderByMock.mockResolvedValue([])

    const result = await listSkillsForUser({ workspaceId: 'ws-1', userId: 'user-1' })

    expect(result.length).toBeGreaterThan(0)
    expect(result.every((s) => s.id.startsWith('builtin-') && s.canEdit === false)).toBe(true)
  })

  it('lets a workspace skill sharing a builtin name override it for everyone', async () => {
    orderByMock.mockResolvedValue([
      { id: 'sk-research', name: 'research', description: 'd', content: 'c', workspaceId: 'ws-1' },
    ])

    const result = await listSkillsForUser({ workspaceId: 'ws-1', userId: 'user-1' })

    expect(result.some((s) => s.id === 'sk-research')).toBe(true)
    expect(result.some((s) => s.id === 'builtin-research')).toBe(false)
  })
})
