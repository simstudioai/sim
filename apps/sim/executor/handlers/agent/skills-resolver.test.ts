/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveSkillContent,
  resolveSkillContentById,
  resolveSkillMetadata,
} from './skills-resolver'

// resolveSkillContent is the shared resolver invoked when a workflow agent
// block calls load_skill. Skill editors gate editing only — resolution never
// blocks on the acting user.
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

afterAll(() => {
  resetDbChainMock()
})

describe('resolveSkillContent', () => {
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
    queueTableRows(schemaMock.skill, [{ content: '# Playbook' }])
    expect(await resolveSkillContent('posthog-playbook', 'ws-1')).toBe('# Playbook')
  })

  it('returns null when the user skill is not found', async () => {
    expect(await resolveSkillContent('missing', 'ws-1')).toBeNull()
  })
})

describe('resolveSkillContentById', () => {
  it('resolves a workspace skill by id', async () => {
    queueTableRows(schemaMock.skill, [{ content: '# Body', name: 'my-skill' }])
    expect(await resolveSkillContentById('sk-1', 'ws-1')).toEqual({
      name: 'my-skill',
      content: '# Body',
    })
  })

  it('returns null when the skill does not exist in the workspace', async () => {
    expect(await resolveSkillContentById('missing', 'ws-1')).toBeNull()
  })
})

describe('resolveSkillMetadata', () => {
  it('returns every attached skill in the workspace', async () => {
    queueTableRows(schemaMock.skill, [
      { id: 'sk-1', name: 'a', description: 'A' },
      { id: 'sk-2', name: 'b', description: 'B' },
    ])

    const metadata = await resolveSkillMetadata([{ skillId: 'sk-1' }, { skillId: 'sk-2' }], 'ws-1')

    expect(metadata.map((m) => m.name)).toEqual(['a', 'b'])
  })
})
