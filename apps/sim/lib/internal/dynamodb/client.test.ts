/**
 * @vitest-environment node
 */
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import { listTables } from '@/lib/internal/dynamodb/client'

describe('DynamoDB client operations', () => {
  it('passes cancellation to every paginated list-tables request', async () => {
    const controller = new AbortController()
    const send = vi
      .fn()
      .mockResolvedValueOnce({ TableNames: ['table-a'], LastEvaluatedTableName: 'table-a' })
      .mockResolvedValueOnce({ TableNames: ['table-b'] })
    const client = { send } as unknown as DynamoDBClient

    await expect(listTables(client, controller.signal)).resolves.toEqual({
      tables: ['table-a', 'table-b'],
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(send.mock.calls[1]?.[1]).toEqual({ abortSignal: controller.signal })
  })
})
