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

const ORIGINAL_SCHEMA = {
  type: 'object' as const,
  properties: {
    filter: { type: 'object' },
    sort: { type: 'object' },
  },
  required: [],
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
      }
    )

    expect(mockReadTableSchemaAsExecutor).toHaveBeenCalledWith({
      tableId: 'table-1',
      userId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
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
      })
    ).rejects.toThrow('Table not found')
  })

  it('fails when trusted execution identity is missing', async () => {
    await expect(
      enrichTableToolSchema('table-1', 'table_query_rows', ORIGINAL_SCHEMA, 'Query rows', {})
    ).rejects.toThrow('User ID is required to enrich table tool schema for table-1')
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
    })

    expect(mockListKnowledgeTagsAsExecutor).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
    expect(result?.properties).toEqual({ Client: { type: 'string', description: 'text tag' } })
  })

  it('omits the executionId outside an active run', async () => {
    mockListKnowledgeTagsAsExecutor.mockResolvedValue([])

    await enrichKBTagsSchema('kb-1', {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })

    expect(mockListKnowledgeTagsAsExecutor).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })
  })

  it.each([
    ['no acting user', { workspaceId: 'workspace-1', workflowId: 'workflow-1' }],
    [
      'no acting workflow to bind the delegation on',
      { workspaceId: 'workspace-1', userId: 'user-1' },
    ],
    ['no acting workspace', { userId: 'user-1', workflowId: 'workflow-1' }],
  ])('skips enrichment with %s rather than issuing an unauthorized read', async (_, context) => {
    await expect(enrichKBTagsSchema('kb-1', context)).resolves.toBeNull()
    expect(mockListKnowledgeTagsAsExecutor).not.toHaveBeenCalled()
  })
})
