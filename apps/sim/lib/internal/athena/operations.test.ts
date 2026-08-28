/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAthenaClient: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/internal/athena/client', () => ({
  createAthenaClient: mocks.createAthenaClient,
}))

import {
  executeAthenaGetQueryResults,
  executeAthenaListNamedQueries,
} from '@/lib/internal/athena/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

describe('Athena operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createAthenaClient.mockReturnValue({ send: mocks.send, destroy: mocks.destroy })
  })

  it('preserves first-page header handling and forwards cancellation', async () => {
    const controller = new AbortController()
    mocks.send.mockResolvedValue({
      ResultSet: {
        ResultSetMetadata: {
          ColumnInfo: [
            { Name: 'name', Type: 'varchar' },
            { Name: 'count', Type: 'bigint' },
          ],
        },
        Rows: [
          { Data: [{ VarCharValue: 'name' }, { VarCharValue: 'count' }] },
          { Data: [{ VarCharValue: 'sim' }, { VarCharValue: '3' }] },
        ],
      },
      NextToken: 'next-page',
      UpdateCount: 1,
    })

    await expect(
      executeAthenaGetQueryResults(
        { ...CONNECTION, queryExecutionId: 'query-id', maxResults: 10 },
        controller.signal
      )
    ).resolves.toEqual({
      success: true,
      output: {
        columns: [
          { name: 'name', type: 'varchar' },
          { name: 'count', type: 'bigint' },
        ],
        rows: [{ name: 'sim', count: '3' }],
        nextToken: 'next-page',
        updateCount: 1,
      },
    })
    expect(mocks.send.mock.calls[0]?.[0].input).toEqual({
      QueryExecutionId: 'query-id',
      MaxResults: 11,
    })
    expect(mocks.send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('does not strip a row or increase the page size on continuation pages', async () => {
    mocks.send.mockResolvedValue({
      ResultSet: {
        ResultSetMetadata: { ColumnInfo: [{ Name: 'name', Type: 'varchar' }] },
        Rows: [{ Data: [{ VarCharValue: 'continued' }] }],
      },
    })

    await expect(
      executeAthenaGetQueryResults({
        ...CONNECTION,
        queryExecutionId: 'query-id',
        maxResults: 10,
        nextToken: 'current-page',
      })
    ).resolves.toMatchObject({ output: { rows: [{ name: 'continued' }] } })
    expect(mocks.send.mock.calls[0]?.[0].input).toEqual({
      QueryExecutionId: 'query-id',
      MaxResults: 10,
      NextToken: 'current-page',
    })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('destroys the client when provider execution fails', async () => {
    mocks.send.mockRejectedValue(new Error('provider failure'))

    await expect(executeAthenaListNamedQueries(CONNECTION)).rejects.toThrow('provider failure')
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
})
