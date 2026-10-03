import { createLogger } from '@sim/logger'
import { loggerMock, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSkillContent } from '@/executor/handlers/agent/skills-resolver'

const mockSkillsLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'SkillsResolver')
].value

// resolveSkillContent is the shared resolver invoked when a workflow agent
// block calls load_skill. Skill editors gate editing only — resolution never
// blocks on the acting user.
beforeEach(() => {
  resetDbChainMock()
})

afterAll(() => {
  resetDbChainMock()
})

describe('resolveSkillContent', () => {
  it('does not log a resolved secret or runtime alias from a missing skill name', async () => {
    const skillName = 'skill-secret __var_API_KEY __sim_code_0_binding_0'

    expect(await resolveSkillContent(skillName, 'ws-1')).toBeNull()

    const logged = JSON.stringify(mockSkillsLogger.warn.mock.calls)
    expect(logged).not.toContain('skill-secret')
    expect(logged).not.toContain('__var_')
    expect(logged).not.toContain('__sim_')
    expect(mockSkillsLogger.warn).toHaveBeenCalledWith('Skill not found', {
      hasSkillName: true,
      workspaceId: 'ws-1',
    })
  })
})
