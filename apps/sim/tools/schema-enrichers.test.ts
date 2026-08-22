/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBuildAPIUrl,
  mockBuildAuthHeaders,
  mockBuildExecutorDelegationHeaders,
  mockExtractAPIErrorMessage,
} = vi.hoisted(() => ({
  mockBuildAPIUrl: vi.fn((path: string, params?: Record<string, string>) => {
    const url = new URL(path, 'http://localhost:3000')
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value)
    }
    return url
  }),
  mockBuildAuthHeaders: vi.fn(),
  mockBuildExecutorDelegationHeaders: vi.fn(),
  mockExtractAPIErrorMessage: vi.fn(),
}))

vi.mock('@/executor/utils/http', () => ({
  buildAPIUrl: mockBuildAPIUrl,
  buildAuthHeaders: mockBuildAuthHeaders,
  buildExecutorDelegationHeaders: mockBuildExecutorDelegationHeaders,
  extractAPIErrorMessage: mockExtractAPIErrorMessage,
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
    mockBuildAuthHeaders.mockResolvedValue({ Authorization: 'Bearer internal-token' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the table through the authenticated detail route and enriches the schema', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            table: {
              name: 'Customers',
              schema: {
                columns: [
                  { name: 'email', type: 'string' },
                  { name: 'score', type: 'number' },
                ],
              },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await enrichTableToolSchema(
      'table-1',
      'table_query_rows',
      ORIGINAL_SCHEMA,
      'Query rows',
      { workspaceId: 'workspace-1', userId: 'user-1' }
    )

    expect(mockBuildAuthHeaders).toHaveBeenCalledWith('user-1')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/table/table-1?workspaceId=workspace-1',
      { headers: { Authorization: 'Bearer internal-token' } }
    )
    expect(result.description).toContain('Table "Customers" columns:')
    expect(result.parameters.required).toContain('filter')
    expect(result.parameters.properties.filter).toMatchObject({
      description: expect.stringContaining('email, score'),
    })
  })

  it('fails when the table detail request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    mockExtractAPIErrorMessage.mockResolvedValue('Table not found')

    await expect(
      enrichTableToolSchema('missing-table', 'table_query_rows', ORIGINAL_SCHEMA, 'Query rows', {
        workspaceId: 'workspace-1',
        userId: 'user-1',
      })
    ).rejects.toThrow('Failed to fetch table schema for missing-table: Table not found')
  })

  it('fails when trusted execution identity is missing', async () => {
    await expect(
      enrichTableToolSchema('table-1', 'table_query_rows', ORIGINAL_SCHEMA, 'Query rows', {})
    ).rejects.toThrow('Workspace ID is required to enrich table tool schema for table-1')
  })
})

describe('enrichKBTagsSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildExecutorDelegationHeaders.mockResolvedValue({
      Authorization: 'Bearer delegation-token',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('binds the tag-definition read to the acting subject and workflow execution', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [{ id: 'td-1', tagSlot: 'tag1', displayName: 'Client', fieldType: 'text' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await enrichKBTagsSchema('kb-1', {
      userId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })

    expect(mockBuildExecutorDelegationHeaders).toHaveBeenCalledWith({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
    expect(result?.properties).toEqual({ Client: { type: 'string', description: 'text tag' } })
  })

  it('omits the executionId outside an active run', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    await enrichKBTagsSchema('kb-1', { userId: 'user-1', workflowId: 'workflow-1' })

    expect(mockBuildExecutorDelegationHeaders).toHaveBeenCalledWith({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
    })
  })

  it.each([
    ['no acting user', { workflowId: 'workflow-1' }],
    ['no acting workflow to bind the delegation on', { userId: 'user-1' }],
  ])('skips enrichment with %s rather than issuing an unauthorized request', async (_, context) => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    await expect(enrichKBTagsSchema('kb-1', context)).resolves.toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockBuildExecutorDelegationHeaders).not.toHaveBeenCalled()
  })
})
