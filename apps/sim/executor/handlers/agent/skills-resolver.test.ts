/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbState } = vi.hoisted(() => ({
  dbState: { results: [] as unknown[][] },
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
  dbState.results = []
})

describe('resolveSkillContent', () => {
  it('returns null without a skill name or workspace', async () => {
    expect(await resolveSkillContent('', 'ws-1')).toBeNull()
    expect(await resolveSkillContent('x', '')).toBeNull()
  })

  it('resolves builtin skills without touching the database', async () => {
    const content = await resolveSkillContent('research', 'ws-1')
    expect(content).toBeTruthy()
  })

  it('resolves a workspace user skill by name', async () => {
    dbState.results = [[{ content: '# Playbook' }]]
    expect(await resolveSkillContent('posthog-playbook', 'ws-1')).toBe('# Playbook')
  })

  it('returns null when the user skill is not found', async () => {
    dbState.results = [[]]
    expect(await resolveSkillContent('missing', 'ws-1')).toBeNull()
  })
})

describe('resolveSkillContentById', () => {
  it('resolves a workspace skill by id', async () => {
    dbState.results = [[{ content: '# Body', name: 'my-skill' }]]
    expect(await resolveSkillContentById('sk-1', 'ws-1')).toEqual({
      name: 'my-skill',
      content: '# Body',
    })
  })

  it('returns null when the skill does not exist in the workspace', async () => {
    dbState.results = [[]]
    expect(await resolveSkillContentById('missing', 'ws-1')).toBeNull()
  })
})

describe('resolveSkillMetadata', () => {
  it('returns every attached skill in the workspace', async () => {
    dbState.results = [
      [
        { id: 'sk-1', name: 'a', description: 'A' },
        { id: 'sk-2', name: 'b', description: 'B' },
      ],
    ]

    const metadata = await resolveSkillMetadata([{ skillId: 'sk-1' }, { skillId: 'sk-2' }], 'ws-1')

    expect(metadata.map((m) => m.name)).toEqual(['a', 'b'])
  })
})
