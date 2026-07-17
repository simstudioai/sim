/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { whereMock } = vi.hoisted(() => ({ whereMock: vi.fn() }))

vi.mock('@sim/db', () => ({
  db: { select: () => ({ from: () => ({ where: whereMock }) }) },
  skill: { workspaceId: 'workspaceId', name: 'name', description: 'description' },
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({})) }))

import { buildUserSkillTool, LOAD_USER_SKILL_TOOL_NAME } from './skills'

describe('buildUserSkillTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null without a workspace id', async () => {
    expect(await buildUserSkillTool('')).toBeNull()
    expect(whereMock).not.toHaveBeenCalled()
  })

  it('returns null when the workspace has no user skills', async () => {
    whereMock.mockResolvedValue([])
    expect(await buildUserSkillTool('ws-1')).toBeNull()
  })

  it('builds one load_user_skill tool with an enum of workspace skill names', async () => {
    whereMock.mockResolvedValue([
      { name: 'posthog-playbook', description: 'PostHog steps' },
      { name: 'brand-voice', description: 'Tone rules' },
    ])

    const tool = await buildUserSkillTool('ws-1')

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

  it('returns null when the skill query fails', async () => {
    whereMock.mockRejectedValue(new Error('db down'))
    expect(await buildUserSkillTool('ws-1')).toBeNull()
  })
})
