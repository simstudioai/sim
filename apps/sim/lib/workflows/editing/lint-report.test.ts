/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  collectUnresolvedReferences: vi.fn(async () => []),
  collectUnresolvedAgentToolReferences: vi.fn(async () => []),
}))

vi.mock('@/lib/workflows/editing/validation', () => ({
  collectUnresolvedReferences: mocks.collectUnresolvedReferences,
  collectUnresolvedAgentToolReferences: mocks.collectUnresolvedAgentToolReferences,
  UNRESOLVABLE_AT_LINT_NOTE: 'unresolvable-at-lint',
  validateConditionHandle: vi.fn(() => ({ valid: true })),
  validateRouterHandle: vi.fn(() => ({ valid: true })),
}))

import {
  buildWorkflowLintReport,
  EMPTY_GRAPH_NOTE,
  NO_ENTRY_BLOCK_NOTE,
  REFERENCES_UNCHECKED_NOTE,
} from '@/lib/workflows/editing/lint-report'

const scope = { workflowId: 'workflow-1', workspaceId: 'workspace-1', subjectUserId: 'user-1' }

function block(id: string, type: string) {
  return {
    id,
    type,
    name: id,
    enabled: true,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
  }
}

function edge(source: string, target: string) {
  return {
    id: `${source}-${target}`,
    source,
    sourceHandle: 'source',
    target,
    targetHandle: 'target',
  }
}

describe('buildWorkflowLintReport notes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * `--blocks '{}' --edges '[]'` used to lint perfectly clean, so a dry run gave
   * no hint that applying it would erase the workflow.
   */
  it('notes a graph with no blocks', async () => {
    const report = await buildWorkflowLintReport({ blocks: {}, edges: [] } as never, scope)

    expect(report.notes).toEqual([EMPTY_GRAPH_NOTE])
    expect(report.sources).toEqual([])
  })

  it('notes a wired graph nothing can start', async () => {
    const report = await buildWorkflowLintReport(
      {
        blocks: { a: block('a', 'function'), b: block('b', 'function') },
        edges: [edge('a', 'b'), edge('b', 'a')],
      } as never,
      scope
    )

    expect(report.sources).toEqual([])
    expect(report.orphanBlocks).toEqual([])
    expect(report.notes).toEqual([NO_ENTRY_BLOCK_NOTE])
  })

  it('notes a graph whose only source is not a trigger', async () => {
    const report = await buildWorkflowLintReport(
      {
        blocks: { agent: block('agent', 'agent'), fn: block('fn', 'function') },
        edges: [edge('agent', 'fn')],
      } as never,
      scope
    )

    expect(report.notes).toContain(NO_ENTRY_BLOCK_NOTE)
  })

  it('adds neither note to a graph a trigger can start', async () => {
    const report = await buildWorkflowLintReport(
      {
        blocks: { start: block('start', 'starter'), fn: block('fn', 'function') },
        edges: [edge('start', 'fn')],
      } as never,
      scope
    )

    expect(report.notes).toEqual([])
  })

  it('keeps the reference-scope note ahead of the graph notes', async () => {
    const report = await buildWorkflowLintReport({ blocks: {}, edges: [] } as never, {
      ...scope,
      subjectUserId: null,
    })

    expect(report.notes).toEqual([REFERENCES_UNCHECKED_NOTE, EMPTY_GRAPH_NOTE])
    expect(mocks.collectUnresolvedReferences).not.toHaveBeenCalled()
  })
})
