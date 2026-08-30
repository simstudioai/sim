/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

// vitest.setup.ts stubs `@/tools/registry` to an empty map so unrelated suites
// do not pay to load every tool. This suite asserts against the REAL tool
// params, so it opts back in.
vi.unmock('@/tools/registry')

import { GitHubBlock, GitHubV2Block } from '@/blocks/blocks/github'
import { getTool } from '@/tools/utils'

function map(params: Record<string, unknown>): Record<string, unknown> {
  const fn = GitHubBlock.tools.config?.params
  if (!fn) throw new Error('GitHub block declares no params mapper')
  return fn(params) as Record<string, unknown>
}

/**
 * Each pair is (block subBlock id, tool param name, tool id). The serializer
 * keys values by subBlock id, so without the mapper the tool param stays
 * undefined and the field is inert.
 */
const RENAMES = [
  ['reaction_content', 'content', 'github_create_issue_reaction'],
  ['reaction_content', 'content', 'github_create_comment_reaction'],
  ['milestone_title', 'title', 'github_create_milestone'],
  ['milestone_title', 'title', 'github_update_milestone'],
  ['milestone_description', 'description', 'github_create_milestone'],
  ['milestone_description', 'description', 'github_update_milestone'],
  ['milestone_state', 'state', 'github_list_milestones'],
  ['milestone_sort', 'sort', 'github_list_milestones'],
  ['fork_name', 'name', 'github_fork_repo'],
  ['fork_sort', 'sort', 'github_list_forks'],
  ['gist_public', 'public', 'github_create_gist'],
] as const

describe('every renamed subBlock reaches its tool param', () => {
  it.each(RENAMES)('%s -> %s', (subBlockId, paramName) => {
    expect(map({ [subBlockId]: 'x' })).toHaveProperty(paramName)
  })

  it.each(RENAMES)(
    '%s targets a param the tool really declares (%s on %s)',
    (_s, paramName, toolId) => {
      const tool = getTool(toolId)
      expect(tool, `${toolId} is not registered`).toBeDefined()
      expect(Object.keys(tool!.params ?? {})).toContain(paramName)
    }
  )

  it.each(RENAMES)('%s is not itself a param of %s', (subBlockId, _p, toolId) => {
    expect(Object.keys(getTool(toolId)!.params ?? {})).not.toContain(subBlockId)
  })
})

/**
 * The mapper runs as the provider `paramsTransform` too, spreading over the
 * model's tool-call arguments. An unguarded assignment would overwrite a
 * model-supplied value with undefined — the agent path is the only path these
 * fields work on today, so it must not regress.
 */
describe('guarded assignment protects the agent tool-calling path', () => {
  it('emits nothing when no source field is present', () => {
    expect(map({ operation: 'github_create_milestone' })).toEqual({})
  })

  it.each(RENAMES)('never writes %s target as undefined', (_s, paramName) => {
    expect(map({ operation: 'x' })).not.toHaveProperty(paramName)
  })

  it('leaves a model-supplied value untouched when the block field is absent', () => {
    const modelArgs = { content: 'rocket', title: 'from the model' }
    expect({ ...modelArgs, ...map(modelArgs) }).toEqual(modelArgs)
  })

  it.each(['', null, undefined])('treats %o as not provided', (empty) => {
    expect(map({ reaction_content: empty })).toEqual({})
  })
})

describe('gist_public coercion', () => {
  it.each([
    ['true', true],
    ['false', false],
    [true, true],
  ])('maps %o to %o', (input, expected) => {
    expect(map({ gist_public: input }).public).toBe(expected)
  })

  it('omits public entirely when untouched, leaving the tool default', () => {
    expect(map({ operation: 'github_create_gist' })).not.toHaveProperty('public')
  })

  it('matches the dropdown option ids the block actually renders', () => {
    const sub = GitHubBlock.subBlocks.find((s) => s.id === 'gist_public')
    expect(sub?.options).toBeDefined()
    const ids = (sub!.options as Array<{ id: string }>).map((o) => o.id)
    expect(ids).toEqual(['false', 'true'])
  })
})

/** Sources that share a target are safe only if their conditions are disjoint. */
describe('sources sharing a target param are condition-disjoint', () => {
  function opsFor(id: string): string[][] {
    return GitHubBlock.subBlocks
      .filter((s) => s.id === id)
      .map((s) => {
        const v = (s.condition as { value?: unknown })?.value
        return Array.isArray(v) ? (v as string[]) : [v as string]
      })
  }
  it.each([
    ['sort', ['fork_sort', 'milestone_sort']],
    ['title', ['milestone_title']],
    ['description', ['milestone_description']],
    ['state', ['milestone_state']],
    ['content', ['reaction_content']],
    ['name', ['fork_name']],
    ['public', ['gist_public']],
  ] as const)('%s sources never render together', (_target, sources) => {
    const seen = new Set<string>()
    for (const src of sources) {
      for (const group of opsFor(src)) {
        for (const op of group) {
          expect(seen.has(op), `${op} renders two sources of the same target`).toBe(false)
          seen.add(op)
        }
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })
})

describe('the v2 block inherits the same mapper', () => {
  it('forwards params from the v1 block', () => {
    expect(GitHubV2Block.tools.config?.params).toBe(GitHubBlock.tools.config?.params)
  })
})
