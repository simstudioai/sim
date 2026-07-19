/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }))

vi.mock('@sim/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: limitMock }) }) }) },
  skill: { workspaceId: 'workspaceId', name: 'name', content: 'content' },
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
}))

import { resolveSkillContent } from './skills-resolver'

// resolveSkillContent is the shared resolver invoked when a workflow agent block
// calls load_skill.
describe('resolveSkillContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null without a skill name or workspace', async () => {
    expect(await resolveSkillContent('', 'ws-1')).toBeNull()
    expect(await resolveSkillContent('x', '')).toBeNull()
  })

  it('resolves builtin skills without touching the database', async () => {
    const content = await resolveSkillContent('research', 'ws-1')
    expect(content).toBeTruthy()
    expect(limitMock).not.toHaveBeenCalled()
  })

  it('resolves a workspace user skill by name', async () => {
    limitMock.mockResolvedValue([{ content: '# Playbook', name: 'posthog-playbook' }])
    expect(await resolveSkillContent('posthog-playbook', 'ws-1')).toBe('# Playbook')
  })

  it('returns null when the user skill is not found', async () => {
    limitMock.mockResolvedValue([])
    expect(await resolveSkillContent('missing', 'ws-1')).toBeNull()
  })
})
