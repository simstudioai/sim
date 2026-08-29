import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/registry')

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

/** The subBlocks the editor renders once `operation` is chosen. */
function visibleSubBlocks(operation: string): SubBlockConfig[] {
  return subBlocks.filter((sb) => {
    const condition = sb.condition as { field: string; value: unknown; not?: boolean } | undefined
    if (!condition) return true
    if (condition.field !== 'operation') return false
    const allowed = Array.isArray(condition.value) ? condition.value : [condition.value]
    return condition.not ? !allowed.includes(operation) : allowed.includes(operation)
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

  it('never emits an undefined value for any alias it does not have a source for', () => {
    if (!mapParams) return

    for (const operation of operations) {
      const mapped = mapParams({ operation })
      for (const [key, value] of Object.entries(mapped)) {
        expect(value, `${operation} emitted undefined for ${key}`).not.toBeUndefined()
      }
    }
  })
})
