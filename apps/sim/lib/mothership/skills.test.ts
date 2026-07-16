/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { whereMock, getSkillAccessForUserMock, canUseSkillMock } = vi.hoisted(() => ({
  whereMock: vi.fn(),
  getSkillAccessForUserMock: vi.fn(),
  canUseSkillMock: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: () => ({ from: () => ({ where: whereMock }) }) },
  skill: {
    id: 'id',
    workspaceId: 'workspaceId',
    name: 'name',
    description: 'description',
    workspaceShared: 'workspaceShared',
  },
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({})) }))
vi.mock('@/lib/skills/access', () => ({
  getSkillAccessForUser: getSkillAccessForUserMock,
  canUseSkill: canUseSkillMock,
}))

import { buildUserSkillTool, LOAD_USER_SKILL_TOOL_NAME } from './skills'

const SKILL_ROWS = [
  { id: 'sk-1', name: 'posthog-playbook', description: 'PostHog steps', workspaceShared: true },
  { id: 'sk-2', name: 'brand-voice', description: 'Tone rules', workspaceShared: true },
]

describe('buildUserSkillTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSkillAccessForUserMock.mockResolvedValue({
      hasWorkspaceAccess: true,
      canAdminWorkspace: false,
      membershipBySkillId: new Map(),
    })
    canUseSkillMock.mockReturnValue(true)
  })

  it('returns null without a workspace id', async () => {
    expect(await buildUserSkillTool('', 'user-1')).toBeNull()
    expect(whereMock).not.toHaveBeenCalled()
  })

  it('returns null without a user id', async () => {
    expect(await buildUserSkillTool('ws-1', '')).toBeNull()
    expect(whereMock).not.toHaveBeenCalled()
  })

  it('returns null when the workspace has no user skills', async () => {
    whereMock.mockResolvedValue([])
    expect(await buildUserSkillTool('ws-1', 'user-1')).toBeNull()
  })

  it('builds one load_user_skill tool with an enum of accessible skill names', async () => {
    whereMock.mockResolvedValue(SKILL_ROWS)

    const tool = await buildUserSkillTool('ws-1', 'user-1')

    expect(tool?.name).toBe(LOAD_USER_SKILL_TOOL_NAME)
    // Must NOT be executeLocally — it dispatches with executor "sim", not the browser client.
    expect(tool?.executeLocally).toBeUndefined()
    expect(tool?.params).toMatchObject({ mothershipToolKind: 'skill' })
    expect(tool?.input_schema).toMatchObject({
      type: 'object',
      properties: { skill_name: { enum: ['posthog-playbook', 'brand-voice'] } },
      required: ['skill_name'],
    })
    expect(tool?.description).toContain('posthog-playbook')
    expect(tool?.description).toContain('brand-voice')
  })

  it('filters skills the acting user cannot access from the catalog', async () => {
    whereMock.mockResolvedValue(SKILL_ROWS)
    canUseSkillMock.mockImplementation((row: { id: string }) => row.id !== 'sk-1')

    const tool = await buildUserSkillTool('ws-1', 'user-1')

    expect(tool?.input_schema).toMatchObject({
      properties: { skill_name: { enum: ['brand-voice'] } },
    })
    expect(tool?.description).not.toContain('posthog-playbook')
  })

  it('returns null when the user can access none of the skills', async () => {
    whereMock.mockResolvedValue(SKILL_ROWS)
    canUseSkillMock.mockReturnValue(false)

    expect(await buildUserSkillTool('ws-1', 'user-1')).toBeNull()
  })

  it('returns null when the skill query fails', async () => {
    whereMock.mockRejectedValue(new Error('db down'))
    expect(await buildUserSkillTool('ws-1', 'user-1')).toBeNull()
  })
})
