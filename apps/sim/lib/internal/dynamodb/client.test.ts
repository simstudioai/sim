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

/** A client that records the marshalled request input DynamoDB would receive. */
function clientCapturing(onInput: (input: Record<string, unknown>) => void) {
  const client = createDynamoDBClient({
    region: 'us-east-1',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'secret',
  })
  client.middlewareStack.add(
    () => async (args) => {
      onInput(args.input as Record<string, unknown>)
      return { output: { $metadata: {}, Items: [], Count: 0 }, response: {} }
    },
    { step: 'build' }
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
          ratio: { N: '0.12345678901234567890123' },
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
          ratio: 0.12345678901234568,
        },
      ],
      count: 1,
      scannedCount: 3,
    })
    client.destroy()
  })

  it('round-trips large-number and binary keys through the pagination cursor', async () => {
    const pageClient = clientReturning({
      Count: 0,
      Items: [],
      LastEvaluatedKey: {
        pk: { S: 'USER#1' },
        sk: { N: '1234567890123456789' },
        bin: { B: new Uint8Array([104, 105]) },
        age: { N: '42' },
        ratio: { N: '0.12345678901234567890123' },
        nearOne: { N: '1.0000000000000000001' },
      },
    })
    const firstPage = await queryItems(pageClient, 'Users', 'pk = :pk', {
      expressionAttributeValues: { ':pk': 'USER#1' },
    })
    const cursor = await Response.json(firstPage.lastEvaluatedKey).json()
    expect(cursor).toEqual({
      pk: 'USER#1',
      sk: { N: '1234567890123456789' },
      bin: { B: 'aGk=' },
      age: 42,
      ratio: { N: '0.12345678901234567890123' },
      nearOne: { N: '1.0000000000000000001' },
    })

    let sentStartKey: unknown
    const client = clientCapturing((input) => {
      sentStartKey = input.ExclusiveStartKey
    })
    await queryItems(client, 'Users', 'pk = :pk', {
      expressionAttributeValues: { ':pk': 'USER#1' },
      exclusiveStartKey: cursor,
    })

    expect(sentStartKey).toEqual({
      pk: { S: 'USER#1' },
      sk: { N: '1234567890123456789' },
      bin: { B: new Uint8Array([104, 105]) },
      age: { N: '42' },
      ratio: { N: '0.12345678901234567890123' },
      nearOne: { N: '1.0000000000000000001' },
    })
    pageClient.destroy()
    client.destroy()
  })
})
