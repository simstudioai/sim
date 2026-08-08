/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockInternalApiUrl, mockBuildAuthHeaders, mockExtractAPIErrorMessage } = vi.hoisted(() => ({
  mockInternalApiUrl: vi.fn(
    (segments: TemplateStringsArray, ...values: unknown[]) =>
      new URL(
        String.raw({ raw: segments }, ...values.map((v) => encodeURIComponent(String(v)))),
        'http://localhost:3000'
      )
  ),
  mockBuildAuthHeaders: vi.fn(),
  mockExtractAPIErrorMessage: vi.fn(),
}))

vi.mock('@/executor/utils/http', () => ({
  internalApiUrl: mockInternalApiUrl,
  buildAuthHeaders: mockBuildAuthHeaders,
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

  it('keeps a traversal-shaped table id inside the table route', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', mockFetch)
    mockExtractAPIErrorMessage.mockResolvedValue('Table not found')

    await expect(
      enrichTableToolSchema(
        '../../workflows/wf-1',
        'table_query_rows',
        ORIGINAL_SCHEMA,
        'Query rows',
        { workspaceId: 'workspace-1', userId: 'user-1' }
      )
    ).rejects.toThrow()

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/table/..%2F..%2Fworkflows%2Fwf-1?workspaceId=workspace-1',
      expect.anything()
    )
  })
})

describe('enrichKBTagsSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildAuthHeaders.mockResolvedValue({ Authorization: 'Bearer internal-token' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches tag definitions as the acting user so the route can authorize them', async () => {
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

    const result = await enrichKBTagsSchema('kb-1', { userId: 'user-1' })

    expect(mockBuildAuthHeaders).toHaveBeenCalledWith('user-1')
    expect(result?.properties).toEqual({ Client: { type: 'string', description: 'text tag' } })
  })

  it('skips enrichment without an acting user rather than issuing an unauthorized request', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    await expect(enrichKBTagsSchema('kb-1', {})).resolves.toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockBuildAuthHeaders).not.toHaveBeenCalled()
  })

  it('keeps a traversal-shaped knowledge base id inside the tag-definitions route', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', mockFetch)

    await enrichKBTagsSchema('../../workflows/wf-1', { userId: 'user-1' })

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/knowledge/..%2F..%2Fworkflows%2Fwf-1/tag-definitions',
      expect.anything()
    )
  })
})
