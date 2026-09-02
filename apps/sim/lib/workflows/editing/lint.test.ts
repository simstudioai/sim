import { describe, expect, it, vi } from 'vitest'
import {
  collectTableBlockFieldIssues,
  collectWorkflowFieldIssues,
  collectWorkflowTableIds,
  formatWorkflowLintMessage,
  hasWorkflowLintIssues,
  lintEditedWorkflowState,
} from './lint'

/**
 * A resource block shaped like `knowledge`: a picker/manual canonical pair for
 * the knowledge base, both `required`, whose tool parameter is `user-or-llm`.
 * That visibility is what hid a missing knowledge base id from lint while the
 * `user-only` table id beside it was reported.
 */
const KNOWLEDGE_BLOCK = {
  name: 'Knowledge',
  category: 'blocks',
  tools: { access: ['knowledge_search'], config: { tool: () => 'knowledge_search' } },
  subBlocks: [
    { id: 'operation', title: 'Operation', type: 'dropdown', options: [{ id: 'search' }] },
    {
      id: 'knowledgeBaseSelector',
      title: 'Knowledge Base',
      type: 'knowledge-base-selector',
      canonicalParamId: 'knowledgeBaseId',
      mode: 'basic',
      required: true,
    },
    {
      id: 'manualKnowledgeBaseId',
      title: 'Knowledge Base ID',
      type: 'short-input',
      canonicalParamId: 'knowledgeBaseId',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      required: false,
      condition: { field: 'operation', value: 'search' },
    },
  ],
  outputs: {},
}

const TABLE_BLOCK = {
  name: 'Table',
  category: 'blocks',
  tools: { access: ['table_v2_query_rows'], config: { tool: () => 'table_v2_query_rows' } },
  subBlocks: [
    { id: 'operation', title: 'Operation', type: 'dropdown', options: [{ id: 'query_rows' }] },
    {
      id: 'tableSelector',
      title: 'Table',
      type: 'table-selector',
      canonicalParamId: 'tableId',
      mode: 'basic',
      required: true,
    },
    {
      id: 'manualTableId',
      title: 'Table ID',
      type: 'short-input',
      canonicalParamId: 'tableId',
      mode: 'advanced',
      required: true,
    },
  ],
  outputs: {},
}

/** Overrides the global registry mock so a `schedule` block carries its real category. */
vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn((type: string) => {
    if (type === 'schedule') return { category: 'triggers', subBlocks: [], outputs: {} }
    if (type === 'knowledge') return KNOWLEDGE_BLOCK
    if (type === 'table_v2') return TABLE_BLOCK
    return undefined
  }),
  getAllBlocks: vi.fn(() => []),
  getBlockMeta: vi.fn(() => undefined),
  getBlockRegistry: vi.fn(() => ({})),
}))

vi.mock('@/tools/metadata', () => ({
  getToolMetadata: vi.fn(() => undefined),
  getToolParams: vi.fn((toolId: string) => {
    if (toolId === 'knowledge_search') {
      return {
        knowledgeBaseId: { type: 'string', required: true, visibility: 'user-or-llm' },
        query: { type: 'string', required: true, visibility: 'user-or-llm' },
      }
    }
    if (toolId === 'table_v2_query_rows') {
      return { tableId: { type: 'string', required: true, visibility: 'user-only' } }
    }
    return undefined
  }),
}))

function baseBlock(id: string, type: string, name: string, subBlocks: Record<string, any> = {}) {
  return {
    id,
    type,
    name,
    enabled: true,
    position: { x: 0, y: 0 },
    subBlocks,
    outputs: {},
  }
}

describe('lintEditedWorkflowState', () => {
  it('reports orphan blocks but allows unconnected condition/router branches', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        condition: baseBlock('condition', 'condition', 'Condition', {
          conditions: {
            value: JSON.stringify([
              { id: 'condition-if', title: 'if', value: 'true' },
              { id: 'condition-else', title: 'else', value: '' },
            ]),
          },
        }),
        router: baseBlock('router', 'router_v2', 'Router', {
          routes: {
            value: [
              { id: 'route-1', title: 'Route 1', value: 'support' },
              { id: 'route-2', title: 'Route 2', value: 'sales' },
            ],
          },
        }),
        agent: baseBlock('agent', 'agent', 'Agent'),
        function: baseBlock('function', 'function', 'Orphan Function'),
        note: baseBlock('note', 'note', 'Note'),
      },
      edges: [
        {
          id: 'edge-start-condition',
          source: 'start',
          sourceHandle: 'source',
          target: 'condition',
          targetHandle: 'target',
        },
        {
          id: 'edge-start-router',
          source: 'start',
          sourceHandle: 'source',
          target: 'router',
          targetHandle: 'target',
        },
        {
          id: 'edge-condition-agent',
          source: 'condition',
          sourceHandle: 'if',
          target: 'agent',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    expect(lint.orphanBlocks).toEqual([
      { blockId: 'function', blockName: 'Orphan Function', blockType: 'function' },
    ])
    expect(lint.emptyOutgoingPorts).toEqual([])
    expect(lint.invalidBranchPorts).toEqual([])
    expect(hasWorkflowLintIssues(lint)).toBe(true)
  })

  it('reports invalid branch handles and missing connection targets', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        condition: baseBlock('condition', 'condition', 'Condition', {
          conditions: {
            value: [{ id: 'condition-if', title: 'if', value: 'true' }],
          },
        }),
        agent: baseBlock('agent', 'agent', 'Agent'),
      },
      edges: [
        {
          id: 'edge-start-condition',
          source: 'start',
          sourceHandle: 'source',
          target: 'condition',
          targetHandle: 'target',
        },
        {
          id: 'edge-condition-agent',
          source: 'condition',
          sourceHandle: 'else',
          target: 'agent',
          targetHandle: 'target',
        },
        {
          id: 'edge-agent-missing',
          source: 'agent',
          sourceHandle: 'source',
          target: 'missing',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    expect(lint.invalidBranchPorts).toEqual([
      expect.objectContaining({
        blockId: 'condition',
        sourceHandle: 'else',
      }),
    ])
    expect(lint.invalidConnectionTargets).toEqual([
      expect.objectContaining({
        sourceBlockId: 'agent',
        targetBlockId: 'missing',
        reason: 'Connection target block does not exist',
      }),
    ])
    expect(hasWorkflowLintIssues(lint)).toBe(true)
  })

  it('returns clean result when every active block and dynamic port is connected', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        router: baseBlock('router', 'router_v2', 'Router', {
          routes: {
            value: [{ id: 'route-1', title: 'Route 1', value: 'support' }],
          },
        }),
        agent: baseBlock('agent', 'agent', 'Agent'),
      },
      edges: [
        {
          id: 'edge-start-router',
          source: 'start',
          sourceHandle: 'source',
          target: 'router',
          targetHandle: 'target',
        },
        {
          id: 'edge-router-agent',
          source: 'router',
          sourceHandle: 'route-0',
          target: 'agent',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    expect(lint).toEqual({
      sources: [{ blockId: 'start', blockName: 'Start', blockType: 'starter' }],
      sinks: [{ blockId: 'agent', blockName: 'Agent', blockType: 'agent' }],
      orphanBlocks: [],
      emptyOutgoingPorts: [],
      invalidBranchPorts: [],
      invalidConnectionTargets: [],
    })
    expect(hasWorkflowLintIssues(lint)).toBe(false)
  })

  it('objectively reports multiple sources without turning disconnected islands into an issue', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        fetch: baseBlock('fetch', 'function', 'FetchCurrentFiles'),
        normalize: baseBlock('normalize', 'function', 'NormalizeFiles'),
        slack: { ...baseBlock('slack', 'slack', 'SlackTrigger'), triggerMode: true },
        filter: baseBlock('filter', 'condition', 'MessageFilter'),
      },
      edges: [
        {
          id: 'e1',
          source: 'start',
          sourceHandle: 'source',
          target: 'fetch',
          targetHandle: 'target',
        },
        {
          id: 'e2',
          source: 'fetch',
          sourceHandle: 'source',
          target: 'normalize',
          targetHandle: 'target',
        },
        {
          id: 'e3',
          source: 'slack',
          sourceHandle: 'source',
          target: 'filter',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    expect(lint.sources.map((b) => b.blockId).sort()).toEqual(['slack', 'start'])
    expect(lint.orphanBlocks).toEqual([])
    expect(lint.emptyOutgoingPorts).toEqual([])
    expect(hasWorkflowLintIssues(lint)).toBe(false)
  })

  it('reports sources and sinks (triggers are sources, terminals are sinks, notes excluded)', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        agent: baseBlock('agent', 'agent', 'Agent'),
        end: baseBlock('end', 'function', 'End'),
        note: baseBlock('note', 'note', 'Note'),
      },
      edges: [
        {
          id: 'e1',
          source: 'start',
          sourceHandle: 'source',
          target: 'agent',
          targetHandle: 'target',
        },
        {
          id: 'e2',
          source: 'agent',
          sourceHandle: 'source',
          target: 'end',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    // 'start' has no incoming edge -> a source, even though it is NOT an orphan (trigger).
    expect(lint.sources).toEqual([{ blockId: 'start', blockName: 'Start', blockType: 'starter' }])
    expect(lint.orphanBlocks).toEqual([])
    // 'end' has no outgoing edge -> a sink.
    expect(lint.sinks).toEqual([{ blockId: 'end', blockName: 'End', blockType: 'function' }])
    // 'agent' has both in and out edges -> neither source nor sink.
    expect(lint.sources.map((b) => b.blockId)).not.toContain('agent')
    expect(lint.sinks.map((b) => b.blockId)).not.toContain('agent')
    // 'note' is excluded from both even though it has no edges.
    expect(lint.sources.map((b) => b.blockId)).not.toContain('note')
    expect(lint.sinks.map((b) => b.blockId)).not.toContain('note')
  })

  it('treats a triggers-category block as an entry, so a wired schedule is a source and not an orphan', () => {
    const workflowState = {
      blocks: {
        schedule: baseBlock('schedule', 'schedule', 'Schedule'),
        agent: baseBlock('agent', 'agent', 'Agent'),
      },
      edges: [
        {
          id: 'e1',
          source: 'schedule',
          sourceHandle: 'source',
          target: 'agent',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    expect(lint.sources).toEqual([
      { blockId: 'schedule', blockName: 'Schedule', blockType: 'schedule' },
    ])
    expect(lint.orphanBlocks).toEqual([])
    expect(hasWorkflowLintIssues(lint)).toBe(false)
  })

  it('warns when loop/parallel start ports are empty', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        loop: baseBlock('loop', 'loop', 'Loop'),
        parallel: baseBlock('parallel', 'parallel', 'Parallel'),
      },
      edges: [
        {
          id: 'e1',
          source: 'start',
          sourceHandle: 'source',
          target: 'loop',
          targetHandle: 'target',
        },
        {
          id: 'e2',
          source: 'loop',
          sourceHandle: 'loop-end-source',
          target: 'parallel',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    expect(lint.emptyOutgoingPorts.map((port) => `${port.blockName}.${port.handle}`)).toEqual([
      'Loop.loop-start-source',
      'Parallel.parallel-start-source',
    ])
    expect(hasWorkflowLintIssues(lint)).toBe(true)
  })

  it('treats loop/parallel start edges as internal so containers can still be sinks', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        loop: baseBlock('loop', 'loop', 'Loop'),
        child: baseBlock('child', 'function', 'Loop Child'),
      },
      edges: [
        {
          id: 'e1',
          source: 'start',
          sourceHandle: 'source',
          target: 'loop',
          targetHandle: 'target',
        },
        {
          id: 'e2',
          source: 'loop',
          sourceHandle: 'loop-start-source',
          target: 'child',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    expect(lint.emptyOutgoingPorts).toEqual([])
    expect(lint.sinks.map((block) => block.blockId).sort()).toEqual(['child', 'loop'])
    expect(hasWorkflowLintIssues(lint)).toBe(false)
  })
})

describe('collectWorkflowFieldIssues', () => {
  function resourceBlock(id: string, type: string, values: Record<string, unknown>) {
    return baseBlock(
      id,
      type,
      id,
      Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]))
    )
  }

  it('reports a required canonical pair whose members are all empty, whatever the tool visibility', () => {
    const issues = collectWorkflowFieldIssues({
      kb: resourceBlock('kb', 'knowledge', {
        operation: 'search',
        knowledgeBaseSelector: null,
        manualKnowledgeBaseId: null,
      }),
      table: resourceBlock('table', 'table_v2', {
        operation: 'query_rows',
        tableSelector: null,
        manualTableId: null,
      }),
    })

    expect(issues).toEqual([
      expect.objectContaining({ blockId: 'kb', missingRequiredFields: ['Knowledge Base'] }),
      expect.objectContaining({ blockId: 'table', missingRequiredFields: ['Table'] }),
    ])
  })

  it('accepts a value on either member of the pair and leaves optional sub-blocks alone', () => {
    const issues = collectWorkflowFieldIssues({
      picked: resourceBlock('picked', 'knowledge', {
        operation: 'search',
        knowledgeBaseSelector: 'kb_123',
        manualKnowledgeBaseId: null,
        query: null,
      }),
      manual: resourceBlock('manual', 'knowledge', {
        operation: 'search',
        knowledgeBaseSelector: null,
        manualKnowledgeBaseId: 'kb_456',
      }),
    })

    expect(issues).toEqual([])
  })
})

/**
 * A Table block's `filter`/`order` name columns by name and are only checked
 * at run time, so a typo — or a column renamed under the block — lints clean
 * and fails inside the block's error edge. Resolved here against the bound
 * table's live schema.
 */
describe('collectTableBlockFieldIssues', () => {
  const tables = new Map([
    ['tbl_leads', { name: 'Leads', columnNames: ['name', 'Wins', 'status'] }],
  ])

  function tableBlock(id: string, values: Record<string, unknown>, type = 'table_v2') {
    return {
      id,
      type,
      name: id,
      subBlocks: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])),
    }
  }

  it('reports filter and sort fields that are not columns of the bound table', () => {
    const issues = collectTableBlockFieldIssues(
      {
        query: tableBlock('query', {
          manualTableId: 'tbl_leads',
          filter:
            '{"any":[{"field":"score","op":"gte","value":10},{"all":[{"field":"wins","op":"gt","value":1},{"field":"region","op":"eq","value":"eu"}]}]}',
          order: '[{"field":"createdAt","direction":"desc"},{"field":"tier","direction":"asc"}]',
        }),
      },
      tables
    )

    expect(issues).toEqual([
      {
        blockId: 'query',
        blockName: 'query',
        blockType: 'table_v2',
        field: 'score',
        tableName: 'Leads',
      },
      {
        blockId: 'query',
        blockName: 'query',
        blockType: 'table_v2',
        field: 'region',
        tableName: 'Leads',
      },
      {
        blockId: 'query',
        blockName: 'query',
        blockType: 'table_v2',
        field: 'tier',
        tableName: 'Leads',
      },
    ])
  })

  it('accepts a bare condition, a record-shaped sort, and the implicit row fields', () => {
    const issues = collectTableBlockFieldIssues(
      {
        query: tableBlock('query', {
          tableSelector: 'tbl_leads',
          filter: '{"field":"id","op":"eq","value":"row_1"}',
          order: '{"updatedAt":"desc","status":"asc"}',
        }),
      },
      tables
    )

    expect(issues).toEqual([])
  })

  it('skips a block whose table is unresolved, and a filter that is a reference or not JSON', () => {
    const issues = collectTableBlockFieldIssues(
      {
        unbound: tableBlock('unbound', {
          manualTableId: '<start.tableId>',
          filter: '{"field":"nope","op":"eq","value":1}',
        }),
        unknownTable: tableBlock('unknownTable', {
          manualTableId: 'tbl_other',
          filter: '{"field":"nope","op":"eq","value":1}',
        }),
        referenced: tableBlock('referenced', {
          manualTableId: 'tbl_leads',
          filter: '{"field":"nope","op":"eq","value":<start.threshold>}',
        }),
        garbage: tableBlock('garbage', { manualTableId: 'tbl_leads', filter: 'not json' }),
        notATable: tableBlock(
          'notATable',
          { manualTableId: 'tbl_leads', filter: '{"field":"nope"}' },
          'agent'
        ),
      },
      tables
    )

    expect(issues).toEqual([])
  })

  it('surfaces the finding through the issue check and the summary', () => {
    const lint = {
      sources: [],
      sinks: [],
      orphanBlocks: [],
      emptyOutgoingPorts: [],
      invalidBranchPorts: [],
      invalidConnectionTargets: [],
      tableFieldIssues: [
        { blockId: 'query', blockName: 'Query leads', field: 'score', tableName: 'Leads' },
      ],
    }

    expect(hasWorkflowLintIssues(lint)).toBe(true)
    expect(formatWorkflowLintMessage(lint)).toContain(
      'Table filter/sort fields that are not columns of the referenced table (the run will fail in the block\'s error edge): "Query leads".score (table "Leads")'
    )
  })
})

describe('collectWorkflowTableIds', () => {
  it('collects the statically bound table of every Table block once, preferring the manual id', () => {
    const ids = collectWorkflowTableIds({
      a: {
        id: 'a',
        type: 'table_v2',
        subBlocks: { manualTableId: { value: 'tbl_1' }, tableSelector: { value: 'tbl_2' } },
      },
      b: { id: 'b', type: 'table_v2', subBlocks: { tableSelector: { value: 'tbl_1' } } },
      c: { id: 'c', type: 'table_v2', subBlocks: { manualTableId: { value: '<start.table>' } } },
      d: { id: 'd', type: 'agent', subBlocks: { manualTableId: { value: 'tbl_3' } } },
    })

    expect(ids).toEqual(['tbl_1'])
  })
})
