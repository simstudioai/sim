/**
 * @vitest-environment node
 */
import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { getEditableSkillIdsMock } = vi.hoisted(() => ({
  getEditableSkillIdsMock: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@sim/utils/id', () => ({ generateId: () => 'gen-uuid', generateShortId: () => 'gen-id' }))
vi.mock('@/lib/skills/access', () => ({
  getEditableSkillIds: getEditableSkillIdsMock,
}))

import { listSkills, listSkillsForUser } from '@/lib/workflows/skills/operations'

describe('listSkills includeBuiltins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('prepends builtin template skills by default', async () => {
    const result = await listSkills({ workspaceId: 'ws-1' })
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((s) => s.id.startsWith('builtin-'))).toBe(true)
  })

  /**
   * The mothership skill inventory passes includeBuiltins: false so it never
   * sees the code-only template skills.
   */
  it('excludes builtin template skills when includeBuiltins is false', async () => {
    queueTableRows(schemaMock.skill, [
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
    resetDbChainMock()
    getEditableSkillIdsMock.mockResolvedValue({
      canAdminWorkspace: false,
      editorSkillIds: new Set(),
    })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('returns every workspace skill tagged with edit access from editor rows', async () => {
    queueTableRows(schemaMock.skill, [
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
    queueTableRows(schemaMock.skill, [
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
    const result = await listSkillsForUser({ workspaceId: 'ws-1', userId: 'user-1' })

    expect(result.length).toBeGreaterThan(0)
    expect(result.every((s) => s.id.startsWith('builtin-') && s.canEdit === false)).toBe(true)
  })

  it('lets a workspace skill sharing a builtin name override it for everyone', async () => {
    queueTableRows(schemaMock.skill, [
      { id: 'sk-research', name: 'research', description: 'd', content: 'c', workspaceId: 'ws-1' },
    ])

    const result = await listSkillsForUser({ workspaceId: 'ws-1', userId: 'user-1' })

    expect(result.some((s) => s.id === 'sk-research')).toBe(true)
    expect(result.some((s) => s.id === 'builtin-research')).toBe(false)
  })
})
