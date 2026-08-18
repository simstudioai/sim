/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const { mockSecureFetch, MOCK_MAX_JSON_BYTES } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  MOCK_MAX_JSON_BYTES: 10 * 1024 * 1024,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mockSecureFetch,
  MAX_JSON_API_RESPONSE_BYTES: MOCK_MAX_JSON_BYTES,
}))

import { POST } from '@/app/api/tools/azure_data_explorer/proxy/route'

const baseBody = {
  clusterUri: 'https://mycluster.eastus.kusto.windows.net',
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  endpoint: 'query',
  database: 'Samples',
  csl: 'print Test="Hello, World!"',
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

/** Queues the Entra token response, then the cluster response. */
function mockCluster(clusterBody: unknown, status = 200) {
  mockSecureFetch.mockReset()
  mockSecureFetch
    .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
    .mockResolvedValueOnce(jsonResponse(clusterBody, status))
}

let secretCounter = 0

/**
 * The route caches Entra tokens per credential, so every test needs its own
 * secret to exercise the token fetch rather than a warm cache entry.
 */
function post(body: Record<string, unknown>) {
  secretCounter += 1
  return POST(
    createMockRequest('POST', { ...body, clientSecret: `secret-${secretCounter}` }) as never,
    undefined as never
  )
}

/**
 * A v1 query answer. The primary result deliberately is NOT the first table, so
 * a reader that ignores the table of contents picks the wrong one.
 */
function queryResponse(options: { severity: number; statusDescription: string }) {
  return {
    Tables: [
      {
        TableName: 'Table_0',
        Columns: [{ ColumnName: 'Value', DataType: 'String', ColumnType: 'string' }],
        Rows: [['{"Visualization":null}']],
      },
      {
        TableName: 'Table_1',
        Columns: [{ ColumnName: 'Test', DataType: 'String', ColumnType: 'string' }],
        Rows: [['Hello, World!']],
      },
      {
        TableName: 'Table_2',
        Columns: [
          { ColumnName: 'Severity', DataType: 'Int32', ColumnType: 'int' },
          { ColumnName: 'StatusCode', DataType: 'Int32', ColumnType: 'int' },
          { ColumnName: 'StatusDescription', DataType: 'String', ColumnType: 'string' },
        ],
        Rows: [[options.severity, 0, options.statusDescription]],
      },
      {
        TableName: 'Table_3',
        Columns: [
          { ColumnName: 'Ordinal', DataType: 'Int64', ColumnType: 'long' },
          { ColumnName: 'Kind', DataType: 'String', ColumnType: 'string' },
          { ColumnName: 'Name', DataType: 'String', ColumnType: 'string' },
        ],
        Rows: [
          [0, 'QueryProperties', '@ExtendedProperties'],
          [1, 'QueryResult', 'PrimaryResult'],
          [2, 'QueryStatus', 'QueryStatus'],
        ],
      },
    ],
  }
}

describe('POST /api/tools/azure_data_explorer/proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
  })

  it('returns the primary result table named by the table of contents', async () => {
    mockCluster(queryResponse({ severity: 4, statusDescription: 'Query completed successfully' }))

    const response = await post(baseBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.output.tableName).toBe('Table_1')
    expect(data.output.columns).toEqual([{ name: 'Test', type: 'string', dataType: 'String' }])
    expect(data.output.rows).toEqual([['Hello, World!']])
    expect(data.output.records).toEqual([{ Test: 'Hello, World!' }])
    expect(data.output.rowCount).toBe(1)
  })

  it('reports a partial query failure even though the cluster answered 200', async () => {
    mockCluster(queryResponse({ severity: 2, statusDescription: 'Query execution has exceeded' }))

    const response = await post(baseBody)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Query execution has exceeded')
  })

  it('does not mistake a result column named Severity for a failed query', async () => {
    const shadowed = queryResponse({
      severity: 4,
      statusDescription: 'Query completed successfully',
    })
    shadowed.Tables[1] = {
      TableName: 'Table_1',
      Columns: [
        { ColumnName: 'Severity', DataType: 'Int32', ColumnType: 'int' },
        { ColumnName: 'StatusDescription', DataType: 'String', ColumnType: 'string' },
      ],
      Rows: [[1, 'disk almost full']],
    }
    mockCluster(shadowed)

    const response = await post(baseBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.output.records).toEqual([{ Severity: 1, StatusDescription: 'disk almost full' }])
  })

  it('returns the first table for a management command, which has no table of contents', async () => {
    mockCluster({
      Tables: [
        {
          TableName: 'Table_0',
          Columns: [{ ColumnName: 'TableName', DataType: 'String', ColumnType: 'string' }],
          Rows: [['StormEvents'], ['Logs']],
        },
      ],
    })

    const response = await post({ ...baseBody, endpoint: 'mgmt', csl: '.show tables' })
    const data = await response.json()

    expect(data.output.records).toEqual([{ TableName: 'StormEvents' }, { TableName: 'Logs' }])
  })

  it('sends the KQL request to the cluster with a bearer token and read-only header', async () => {
    mockCluster(queryResponse({ severity: 4, statusDescription: 'Query completed successfully' }))

    await post({ ...baseBody, readOnly: true })

    const [url, options] = mockSecureFetch.mock.calls[1]
    expect(url).toBe('https://mycluster.eastus.kusto.windows.net/v1/rest/query')
    expect(options.headers.Authorization).toBe('Bearer token-1')
    expect(options.headers['x-ms-readonly']).toBe('true')
    expect(JSON.parse(options.body)).toEqual({ db: 'Samples', csl: baseBody.csl })
  })

  it('requests an Entra token audience of the cluster origin by default', async () => {
    mockCluster(queryResponse({ severity: 4, statusDescription: 'Query completed successfully' }))

    await post(baseBody)

    const [tokenUrl, tokenOptions] = mockSecureFetch.mock.calls[0]
    expect(tokenUrl).toBe('https://login.microsoftonline.com/tenant-1/oauth2/token')
    expect(Object.fromEntries(new URLSearchParams(tokenOptions.body))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'client-1',
      client_secret: `secret-${secretCounter}`,
      resource: 'https://mycluster.eastus.kusto.windows.net',
    })
  })

  it.each([
    ['https://c.usgovvirginia.kusto.usgovcloudapi.net', 'https://login.microsoftonline.us'],
    ['https://c.chinanorth.kusto.chinacloudapi.cn', 'https://login.partner.microsoftonline.cn'],
    ['https://c.eastus.kusto.windows.net', 'https://login.microsoftonline.com'],
  ])('authenticates %s against its own cloud Entra authority', async (clusterUri, authority) => {
    mockCluster(queryResponse({ severity: 4, statusDescription: 'Query completed successfully' }))

    const response = await post({ ...baseBody, clusterUri, resource: undefined })

    expect(response.status).toBe(200)
    const [tokenUrl] = mockSecureFetch.mock.calls[0]
    expect(tokenUrl).toBe(`${authority}/tenant-1/oauth2/token`)
  })

  it('rejects a cluster URI outside the Kusto service domains', async () => {
    mockCluster(queryResponse({ severity: 4, statusDescription: 'Query completed successfully' }))

    const response = await post({ ...baseBody, clusterUri: 'https://evil.example.com' })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('Azure Data Explorer or Fabric Eventhouse endpoint')
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('surfaces the Kusto error envelope on a failed request', async () => {
    mockCluster({ error: { code: 'BadRequest_SyntaxError', message: "Syntax error: 'wher'" } }, 400)

    const response = await post(baseBody)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe("[BadRequest_SyntaxError] Syntax error: 'wher'")
  })

  it('rejects an entity name outside the documented Kusto identifier character set', async () => {
    const response = await post({ ...baseBody, database: 'Samples"] | drop table X //' })

    expect(response.status).toBe(400)
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('accepts an apex token audience, which is the Fabric Eventhouse form', async () => {
    mockCluster(queryResponse({ severity: 4, statusDescription: 'Query completed successfully' }))

    const response = await post({ ...baseBody, resource: 'https://kusto.fabric.microsoft.com' })

    expect(response.status).toBe(200)
    const [, tokenOptions] = mockSecureFetch.mock.calls[0]
    expect(Object.fromEntries(new URLSearchParams(tokenOptions.body)).resource).toBe(
      'https://kusto.fabric.microsoft.com'
    )
  })

  it('caps the rows it returns and reports what the cluster actually produced', async () => {
    const wide = queryResponse({ severity: 4, statusDescription: 'Query completed successfully' })
    wide.Tables[1].Rows = Array.from({ length: 10_050 }, (_, i) => [`row-${i}`])
    mockCluster(wide)

    const response = await post(baseBody)
    const data = await response.json()

    expect(data.output.rowCount).toBe(10_000)
    expect(data.output.rows).toHaveLength(10_000)
    expect(data.output.records).toHaveLength(10_000)
    expect(data.output.totalRowCount).toBe(10_050)
    expect(data.output.truncated).toBe(true)
  })

  it('reports truncated as false when every row fits', async () => {
    mockCluster(queryResponse({ severity: 4, statusDescription: 'Query completed successfully' }))

    const response = await post(baseBody)
    const data = await response.json()

    expect(data.output.truncated).toBe(false)
    expect(data.output.totalRowCount).toBe(1)
  })

  it('bounds the cluster response body rather than reading it unlimited', async () => {
    mockCluster(queryResponse({ severity: 4, statusDescription: 'Query completed successfully' }))

    await post(baseBody)

    const [, options] = mockSecureFetch.mock.calls[1]
    expect(options.maxResponseBytes).toBe(MOCK_MAX_JSON_BYTES)
  })

  it('asks the caller to narrow the query when the response exceeds the cap', async () => {
    mockSecureFetch.mockReset()
    mockSecureFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockRejectedValueOnce(
        new PayloadSizeLimitError({
          label: 'Azure Data Explorer response',
          maxBytes: MOCK_MAX_JSON_BYTES,
        })
      )

    const response = await post(baseBody)
    const data = await response.json()

    expect(response.status).toBe(413)
    expect(data.error).toContain('Narrow the query')
  })

  it('rejects an unauthenticated request before reaching the cluster', async () => {
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: false,
      error: 'Authentication required',
    })

    const response = await post(baseBody)

    expect(response.status).toBe(401)
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })
})
