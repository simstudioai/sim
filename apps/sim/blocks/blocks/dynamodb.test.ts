/**
 * An Agent tool call runs the block mapper over `{ ...storedRowParams, ...modelArgs }` with the
 * operation only in `context`; the internal tool then receives `{ ...merged, ...mapped }`.
 */
import { describe, expect, it } from 'vitest'
import { DynamoDBBlock } from '@/blocks/blocks/dynamodb'

function toolParams(operation: string, args: Record<string, unknown>) {
  return { ...args, ...DynamoDBBlock.tools.config?.params?.(args, { operation }) }
}

const AWS_ARGS = {
  region: 'us-east-1',
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
  tableName: 'orders',
}

describe('DynamoDB on an Agent tool call', () => {
  it('get sends the primary key stored on the tool row', () => {
    expect(toolParams('get', { ...AWS_ARGS, getKey: '{"id":"1"}' }).key).toEqual({ id: '1' })
  })

  it('scan keeps the index, projection, and consistent read the model supplied', () => {
    expect(
      toolParams('scan', {
        ...AWS_ARGS,
        indexName: 'by-status',
        projectionExpression: 'id, status',
        consistentRead: true,
      })
    ).toMatchObject({
      indexName: 'by-status',
      projectionExpression: 'id, status',
      consistentRead: true,
    })
  })

  it('update keeps the return values the model supplied over the seeded dropdown default', () => {
    expect(
      toolParams('update', {
        ...AWS_ARGS,
        updateKey: '{"id":"1"}',
        updateExpression: 'SET #s = :s',
        updateReturnValues: 'ALL_NEW',
        returnValues: 'UPDATED_OLD',
      }).returnValues
    ).toBe('UPDATED_OLD')
  })
})
