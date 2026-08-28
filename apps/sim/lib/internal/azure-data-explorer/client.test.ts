/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { secureFetch } = vi.hoisted(() => ({ secureFetch: vi.fn() }))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithValidation: secureFetch,
}))

import {
  AzureDataExplorerOperationError,
  requestAzureDataExplorer,
} from '@/lib/internal/azure-data-explorer/client'

const BASE_INPUT = {
  clusterUri: 'https://mycluster.eastus.kusto.windows.net',
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  endpoint: 'query' as const,
  database: 'Samples',
  csl: 'print Test="Hello, World!"',
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function queryResponse(severity = 4) {
  return {
    Tables: [
      {
        TableName: 'Table_0',
        Columns: [{ ColumnName: 'Value', DataType: 'String', ColumnType: 'string' }],
        Rows: [['metadata']],
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
          { ColumnName: 'StatusDescription', DataType: 'String', ColumnType: 'string' },
        ],
        Rows: [[severity, severity <= 2 ? 'Query failed' : 'Query completed']],
      },
      {
        TableName: 'Table_3',
        Columns: [{ ColumnName: 'Ordinal' }, { ColumnName: 'Kind' }],
        Rows: [
          [0, 'QueryProperties'],
          [1, 'QueryResult'],
          [2, 'QueryStatus'],
        ],
      },
    ],
  }
}

describe('requestAzureDataExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    secureFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(queryResponse()))
  })

  it('preserves the token audience, read-only header, and primary-table projection', async () => {
    const output = await requestAzureDataExplorer(
      { ...BASE_INPUT, clientSecret: 'unique-1', readOnly: true },
      'request-1'
    )

    expect(secureFetch.mock.calls[0][0]).toBe(
      'https://login.microsoftonline.com/tenant-1/oauth2/token'
    )
    expect(
      Object.fromEntries(new URLSearchParams(secureFetch.mock.calls[0][1].body))
    ).toMatchObject({
      client_id: 'client-1',
      resource: 'https://mycluster.eastus.kusto.windows.net',
    })
    expect(secureFetch.mock.calls[1][0]).toBe(
      'https://mycluster.eastus.kusto.windows.net/v1/rest/query'
    )
    expect(secureFetch.mock.calls[1][1].headers['x-ms-readonly']).toBe('true')
    expect(output).toMatchObject({
      tableName: 'Table_1',
      records: [{ Test: 'Hello, World!' }],
      rowCount: 1,
      totalRowCount: 1,
      truncated: false,
    })
  })

  it('preserves partial Kusto failures reported inside an HTTP 200 response', async () => {
    secureFetch.mockReset()
    secureFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(queryResponse(2)))

    await expect(
      requestAzureDataExplorer({ ...BASE_INPUT, clientSecret: 'unique-2' }, 'request-2')
    ).rejects.toEqual(new AzureDataExplorerOperationError('Query failed', 400, 200))
  })

  it('caps projected rows while retaining the provider row count', async () => {
    secureFetch.mockReset()
    const response = queryResponse()
    response.Tables[1].Rows = Array.from({ length: 10_050 }, (_, index) => [`row-${index}`])
    secureFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(response))

    const output = await requestAzureDataExplorer(
      { ...BASE_INPUT, clientSecret: 'unique-3' },
      'request-3'
    )

    expect(output.rows).toHaveLength(10_000)
    expect(output.records).toHaveLength(10_000)
    expect(output).toMatchObject({ rowCount: 10_000, totalRowCount: 10_050, truncated: true })
  })

  it('propagates cancellation before any provider request', async () => {
    secureFetch.mockReset()
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      requestAzureDataExplorer(BASE_INPUT, 'request-4', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(secureFetch).not.toHaveBeenCalled()
  })
})
