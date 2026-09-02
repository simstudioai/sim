/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  collectUnresolvedReferences: vi.fn(async () => []),
  collectUnresolvedAgentToolReferences: vi.fn(async () => []),
  getTableById: vi.fn(async () => null),
}))

vi.mock('@/lib/table/service', () => ({ getTableById: mocks.getTableById }))

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

/**
 * The report builder is the one place with database access, so it resolves
 * each Table block's filter and sort fields against the bound table's live
 * schema — for every caller, since a table schema is workspace data rather
 * than a human's grant.
 */
describe('buildWorkflowLintReport table fields', () => {
  const leads = {
    id: 'tbl_leads',
    name: 'Leads',
    workspaceId: 'workspace-1',
    schema: { columns: [{ id: 'col_name', name: 'name', type: 'string' }] },
  }

  function tableBlock(id: string, values: Record<string, unknown>) {
    return {
      ...block(id, 'table_v2'),
      subBlocks: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, { id: key, type: 'code', value }])
      ),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTableById.mockImplementation(async (tableId: string) =>
      tableId === 'tbl_leads' ? leads : null
    )
  })

  it('reports a filter field the bound table has no column for', async () => {
    const report = await buildWorkflowLintReport(
      {
        blocks: {
          start: block('start', 'starter'),
          query: tableBlock('query', {
            manualTableId: 'tbl_leads',
            filter: '{"field":"score","op":"gte","value":10}',
          }),
        },
        edges: [edge('start', 'query')],
      } as never,
      { ...scope, subjectUserId: null }
    )

    expect(mocks.getTableById).toHaveBeenCalledWith('tbl_leads')
    expect(report.tableFieldIssues).toEqual([
      {
        blockId: 'query',
        blockName: 'query',
        blockType: 'table_v2',
        field: 'score',
        tableName: 'Leads',
      },
    ])
  })

  it('skips a table outside the workspace and reports an empty finding when the lookup fails', async () => {
    mocks.getTableById.mockResolvedValueOnce({ ...leads, workspaceId: 'workspace-2' })
    const graph = {
      blocks: {
        query: tableBlock('query', {
          manualTableId: 'tbl_leads',
          filter: '{"field":"score","op":"gte","value":10}',
        }),
      },
      edges: [],
    } as never

    expect((await buildWorkflowLintReport(graph, scope)).tableFieldIssues).toEqual([])

    mocks.getTableById.mockRejectedValueOnce(new Error('tables unavailable'))
    expect((await buildWorkflowLintReport(graph, scope)).tableFieldIssues).toEqual([])
  })
})
