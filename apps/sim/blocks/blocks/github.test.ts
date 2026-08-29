import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/registry')

import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { GitHubBlock } from '@/blocks/blocks/github'
import type { SubBlockConfig } from '@/blocks/types'
import { tools as toolRegistry } from '@/tools/registry'
import type { ToolConfig } from '@/tools/types'

/**
 * Params the surface supplies rather than the user, so a missing subBlock for
 * one is not a wiring defect.
 */
const INJECTED_PARAMS = new Set(['apiKey', 'accessToken', 'credential'])

type AnyRecord = Record<string, unknown>

const subBlocks = GitHubBlock.subBlocks as SubBlockConfig[]
const selectTool = (GitHubBlock.tools.config as { tool: (p: AnyRecord) => string }).tool
const mapParams = (GitHubBlock.tools.config as { params?: (p: AnyRecord) => AnyRecord } | undefined)
  ?.params

const operations: string[] = (
  (subBlocks.find((sb) => sb.id === 'operation')?.options as { id: string }[] | undefined) ?? []
).map((option) => option.id)

/**
 * The subBlocks that can be rendered for an operation, evaluated with the
 * block's own condition evaluator rather than a reimplementation of it.
 *
 * "Can be" rather than "are": a compound condition gates a subBlock on a second
 * field as well as the operation — `github_comment`'s `path` and `line` need
 * `commentType: 'file_comment'` — so the secondary gate is satisfied here
 * before evaluating. That is the right question for a reachability guard, which
 * asks whether an operation has *any* way to supply a required param, not
 * whether one particular editor state happens to show it. Hand-rolling the
 * match instead would silently ignore `and:` and over-report, which is the same
 * false confidence this file exists to remove.
 */
function visibleSubBlocks(operation: string): SubBlockConfig[] {
  return subBlocks.filter((sb) => {
    const condition = sb.condition
    if (!condition) return true
    if (typeof condition === 'function') return false

    const values: AnyRecord = { operation }
    const secondary = (condition as { and?: { field: string; value: unknown } }).and
    if (secondary) {
      values[secondary.field] = Array.isArray(secondary.value)
        ? secondary.value[0]
        : secondary.value
    }

    return condition.field === 'operation' && evaluateSubBlockCondition(condition, values)
  })
}

/**
 * Reproduces `generic-handler`'s merge: the mapper's output is spread over the
 * raw subBlock values, so a mapper key always wins.
 */
function resolveToolInputs(operation: string, extra: AnyRecord = {}): AnyRecord {
  const inputs: AnyRecord = { operation, ...extra }
  for (const sb of visibleSubBlocks(operation)) {
    if (sb.id === 'operation' || sb.id in inputs) continue
    inputs[sb.id] = `value-for-${sb.id}`
  }
  return mapParams ? { ...inputs, ...mapParams(inputs) } : inputs
}

describe('GitHub block param wiring', () => {
  it('exposes at least one operation', () => {
    expect(operations.length).toBeGreaterThan(0)
  })

  /**
   * The regression guard for this whole class of bug. A subBlock binds to a tool
   * param only when its id matches the param name (`tools/params.ts`), so an id
   * that merely *looks* related is inert and the operation fails at the API.
   */
  it('supplies every required tool param for every operation', () => {
    const unsatisfied: string[] = []

    for (const operation of operations) {
      const toolId = selectTool({ operation })
      const tool = (toolRegistry as Record<string, ToolConfig>)[toolId]
      if (!tool?.params) continue

      const resolved = resolveToolInputs(operation)
      for (const [paramName, spec] of Object.entries(tool.params)) {
        if (!spec.required || INJECTED_PARAMS.has(paramName)) continue
        if (resolved[paramName] === undefined) {
          unsatisfied.push(`${operation} -> ${toolId}.${paramName}`)
        }
      }
    }

    expect(unsatisfied).toEqual([])
  })

  it('sends a public gist as a real boolean when the user picks Public', () => {
    const resolved = resolveToolInputs('github_create_gist', { gist_public: 'true' })

    expect(resolved.public).toBe(true)
  })

  it('sends a secret gist as a real boolean when the user picks Secret', () => {
    const resolved = resolveToolInputs('github_create_gist', { gist_public: 'false' })

    expect(resolved.public).toBe(false)
  })

  it('coerces enforce_admins to a boolean rather than the dropdown string', () => {
    const resolved = resolveToolInputs('github_update_branch_protection', {
      enforce_admins: 'true',
    })

    expect(resolved.enforce_admins).toBe(true)
  })

  /**
   * `generic-handler` merges `{ ...inputs, ...params(inputs) }`, so an
   * unconditional assignment writes `undefined` over a value the model supplied
   * directly under the tool's own param name. Every alias must be guarded.
   */
  it('never clobbers a model-supplied param when its alias subBlock is empty', () => {
    if (!mapParams) return

    const modelSupplied: AnyRecord = {
      operation: 'github_create_issue_reaction',
      owner: 'octocat',
      repo: 'hello',
      issue_number: 1,
      content: '+1',
    }

    const merged = { ...modelSupplied, ...mapParams(modelSupplied) }

    expect(merged.content).toBe('+1')
  })

  /**
   * An alias key that is *absent* means the caller addressed the tool param
   * directly — the agent path — so the mapper must not touch it. An alias key
   * that is *present but blank* means the operator cleared the field, and the
   * target has to be cleared with it: stored block state keeps values for
   * fields the current operation does not render, so a same-named leftover
   * (`title` from Create Issue, `sort` from a search) would otherwise be sent.
   */
  it('clears a stale canonical value when its alias field is blank', () => {
    if (!mapParams) return

    const merged = {
      operation: 'github_update_milestone',
      milestone_title: '',
      title: 'left over from Create Issue',
      ...mapParams({
        operation: 'github_update_milestone',
        milestone_title: '',
        title: 'left over from Create Issue',
      }),
    }

    expect(merged.title).toBeUndefined()
  })

  it('leaves the tool param alone when the alias key is absent entirely', () => {
    if (!mapParams) return

    const direct = { operation: 'github_update_milestone', title: 'model supplied' }
    const merged = { ...direct, ...mapParams(direct) }

    expect(merged.title).toBe('model supplied')
  })

  /**
   * `protected` is a tri-state in the UI and a boolean on the wire; `list_branches`
   * appends the filter whenever it is not `undefined`, so the "All" sentinel would
   * be sent as the invalid `protected=all`.
   */
  it('omits the protection filter when All is selected', () => {
    const resolved = resolveToolInputs('github_list_branches', { protected: 'all' })

    expect(resolved.protected).toBeUndefined()
  })

  it('still sends the protection filter as a boolean when one is chosen', () => {
    expect(resolveToolInputs('github_list_branches', { protected: 'true' }).protected).toBe(true)
    expect(resolveToolInputs('github_list_branches', { protected: 'false' }).protected).toBe(false)
  })
})
