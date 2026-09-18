/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListKnowledgeTagsAsExecutor, mockReadTableSchemaAsExecutor } = vi.hoisted(() => ({
  mockListKnowledgeTagsAsExecutor: vi.fn(),
  mockReadTableSchemaAsExecutor: vi.fn(),
}))

vi.mock('@/lib/internal/knowledge/list-tags', () => ({
  listKnowledgeTagsAsExecutor: mockListKnowledgeTagsAsExecutor,
}))

vi.mock('@/lib/internal/table/read-schema', () => ({
  readTableSchemaAsExecutor: mockReadTableSchemaAsExecutor,
}))

import { enrichKBTagsSchema, enrichTableToolSchema } from '@/tools/schema-enrichers'
import { tableQueryRowsV2Tool } from '@/tools/table/query_rows_v2'

const ORIGINAL_SCHEMA = {
  type: 'object' as const,
  properties: {
    filter: { type: 'object' },
    sort: { type: 'object' },
  },
  required: [],
}

const V2_SCHEMA = {
  type: 'object' as const,
  properties: {
    filter: { type: 'object' },
    order: { type: 'array' },
    columns: { type: 'array' },
    limit: { type: 'number' },
    cursor: { type: 'string' },
  },
  required: [],
}

const EXECUTOR_ORIGIN = {
  subjectUserId: 'user-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}

describe('enrichTableToolSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadTableSchemaAsExecutor.mockResolvedValue({
      name: 'Customers',
      columns: [
        { name: 'email', type: 'string' },
        { name: 'score', type: 'number' },
      ],
    })
  })

  it('reads the table through the authorized operation and enriches the schema', async () => {
    const result = await enrichTableToolSchema(
      'table-1',
      'table_query_rows',
      ORIGINAL_SCHEMA,
      'Query rows',
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        executorDelegationOrigin: EXECUTOR_ORIGIN,
      }
    )

    expect(mockReadTableSchemaAsExecutor).toHaveBeenCalledWith({
      tableId: 'table-1',
      context: {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        executorDelegationOrigin: EXECUTOR_ORIGIN,
      },
    })
    expect(result.description).toContain('Table "Customers" columns:')
    expect(result.parameters.required).toContain('filter')
    expect(result.parameters.properties.filter).toMatchObject({
      description: expect.stringContaining('email, score'),
    })
  })

  it('fails when the authorized table read fails', async () => {
    mockReadTableSchemaAsExecutor.mockRejectedValue(new Error('Table not found'))

    await expect(
      enrichTableToolSchema('missing-table', 'table_query_rows', ORIGINAL_SCHEMA, 'Query rows', {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workflowId: 'workflow-1',
        executorDelegationOrigin: EXECUTOR_ORIGIN,
      })
    ).rejects.toThrow('Table not found')
  })

  it('fails when trusted execution identity is missing', async () => {
    await expect(
      enrichTableToolSchema('table-1', 'table_query_rows', ORIGINAL_SCHEMA, 'Query rows', {})
    ).rejects.toThrow('Workflow ID is required to enrich table tool schema for table-1')
  })

  /**
   * The v2 query tool shipped with no enrichment at all, so an agent using it
   * never saw the table's columns. These pin both halves of the fix: the tool
   * declares the wiring, and the enricher answers it in v2's grammar rather
   * than v1's.
   */
  it('wires the v2 query tool to the enricher under its own tool id', () => {
    expect(tableQueryRowsV2Tool.toolEnrichment?.dependsOn).toBe('tableId')
    expect(tableQueryRowsV2Tool.toolEnrichment?.enrichTool).toBeTypeOf('function')
  })

  it('enriches the v2 query tool with predicate grammar, not the v1 filter grammar', async () => {
    const result = await enrichTableToolSchema(
      'table-1',
      'table_query_rows_v2',
      V2_SCHEMA,
      'Query rows',
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        executorDelegationOrigin: EXECUTOR_ORIGIN,
      }
    )

    expect(result.description).toContain('Table "Customers" columns:')
    expect(result.description).toContain('"op":"gte"')
    expect(result.description).not.toContain('$eq')
    expect(result.parameters.properties.filter).toMatchObject({
      description: expect.stringContaining('email, score'),
    })
    expect(result.parameters.properties.cursor).toMatchObject({
      description: expect.stringContaining('nextCursor'),
    })
    // v2 returns every row when the filter is omitted, so it must stay optional.
    expect(result.parameters.required).not.toContain('filter')
  })
})

describe('enrichKBTagsSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListKnowledgeTagsAsExecutor.mockResolvedValue([
      { id: 'td-1', tagSlot: 'tag1', displayName: 'Client', fieldType: 'text' },
    ])
  })

  it('binds the tag-definition read to the acting workflow execution', async () => {
    const result = await enrichKBTagsSchema('kb-1', {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      executorDelegationOrigin: EXECUTOR_ORIGIN,
    })

    expect(mockListKnowledgeTagsAsExecutor).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      workspaceId: 'workspace-1',
      context: {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        executorDelegationOrigin: EXECUTOR_ORIGIN,
      },
    })
    expect(result?.properties).toEqual({ Client: { type: 'string', description: 'text tag' } })
  })

  it('omits the executionId outside an active run', async () => {
    mockListKnowledgeTagsAsExecutor.mockResolvedValue([])

    const result = await enrichKBTagsSchema('kb-1', {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executorDelegationOrigin: EXECUTOR_ORIGIN,
    })

    expect(mockListKnowledgeTagsAsExecutor).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      workspaceId: 'workspace-1',
      context: {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workflowId: 'workflow-1',
        executorDelegationOrigin: EXECUTOR_ORIGIN,
      },
    })
    expect(result).toBeNull()
  })

  it.each([
    ['no execution authority', { workspaceId: 'workspace-1', workflowId: 'workflow-1' }],
    [
      'no acting workflow to bind the delegation on',
      { workspaceId: 'workspace-1', userId: 'user-1', executorDelegationOrigin: EXECUTOR_ORIGIN },
    ],
    [
      'no acting workspace',
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        executorDelegationOrigin: EXECUTOR_ORIGIN,
      },
    ],
  ])('skips enrichment with %s rather than issuing an unauthorized read', async (_, context) => {
    await expect(enrichKBTagsSchema('kb-1', context)).resolves.toBeNull()
    expect(mockListKnowledgeTagsAsExecutor).not.toHaveBeenCalled()
  })
})
