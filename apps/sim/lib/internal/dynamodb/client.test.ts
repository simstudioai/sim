import { describe, expect, it } from 'vitest'
import { createDynamoDBClient, queryItems } from '@/lib/internal/dynamodb/client'

function clientReturning(output: Record<string, unknown>) {
  const client = createDynamoDBClient({
    region: 'us-east-1',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'secret',
  })
  client.middlewareStack.addRelativeTo(
    () => async () => ({ output: { $metadata: {}, ...output }, response: {} }),
    { relation: 'after', toMiddleware: 'DocumentUnmarshall' }
  )
  return client
}

describe('DynamoDB item unmarshalling', () => {
  it('returns JSON-serializable items for sets, binary and integers beyond 2^53', async () => {
    const client = clientReturning({
      Count: 1,
      ScannedCount: 3,
      Items: [
        {
          pk: { S: 'USER#1' },
          tags: { SS: ['a', 'b'] },
          scores: { NS: ['1', '2'] },
          avatar: { B: new Uint8Array([104, 105]) },
          snowflake: { N: '1234567890123456789' },
          age: { N: '42' },
        },
      ],
    })

    const result = await queryItems(client, 'Users', 'pk = :pk', {
      expressionAttributeValues: { ':pk': 'USER#1' },
    })

    expect(await Response.json(result).json()).toEqual({
      items: [
        {
          pk: 'USER#1',
          tags: ['a', 'b'],
          scores: [1, 2],
          avatar: 'aGk=',
          snowflake: '1234567890123456789',
          age: 42,
        },
      ],
      count: 1,
      scannedCount: 3,
    })
    client.destroy()
  })
})
