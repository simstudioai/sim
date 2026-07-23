/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSkillContent } from './skills-resolver'

// resolveSkillContent is the shared resolver invoked when a workflow agent block
// calls load_skill.
describe('resolveSkillContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('returns null without a skill name or workspace', async () => {
    expect(await resolveSkillContent('', 'ws-1')).toBeNull()
    expect(await resolveSkillContent('x', '')).toBeNull()
  })

  it('resolves builtin skills without touching the database', async () => {
    const content = await resolveSkillContent('research', 'ws-1')
    expect(content).toBeTruthy()
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('resolves a workspace user skill by name', async () => {
    queueTableRows(schemaMock.skill, [{ content: '# Playbook', name: 'posthog-playbook' }])
    expect(await resolveSkillContent('posthog-playbook', 'ws-1')).toBe('# Playbook')
  })

  it('returns null when the user skill is not found', async () => {
    expect(await resolveSkillContent('missing', 'ws-1')).toBeNull()
  })
})
