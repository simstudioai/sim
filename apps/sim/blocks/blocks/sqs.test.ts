import { describe, expect, it } from 'vitest'
import { SQSBlock } from '@/blocks/blocks/sqs'

const mapParams = SQSBlock.tools.config?.params
if (!mapParams) {
  throw new Error('SQS block must define tools.config.params')
}

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'secret',
}

const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue'

describe('SQS block integer parsing', () => {
  it('rejects a fractional value instead of truncating it', () => {
    expect(() =>
      mapParams({ ...CONNECTION, operation: 'send', queueUrl: QUEUE_URL, delaySeconds: '1.5' })
    ).toThrow('delaySeconds must be a whole number')
  })

  it('rejects a value with a trailing suffix instead of forwarding the digits', () => {
    expect(() =>
      mapParams({
        ...CONNECTION,
        operation: 'receive_message',
        queueUrl: QUEUE_URL,
        maxNumberOfMessages: '10abc',
      })
    ).toThrow('maxNumberOfMessages must be a whole number')
  })
})

/**
 * On an agent tool call the operation arrives only on `context`, and the merged row and model
 * values are keyed by the tool's param names (row fields hold strings).
 */
describe('SQS block agent tool calls', () => {
  it('coerces the delay typed in the tool row when sending a message', () => {
    const merged = { ...CONNECTION, queueUrl: QUEUE_URL, data: '{"a":1}', delaySeconds: '5' }
    expect({ ...merged, ...mapParams(merged, { operation: 'send' }) }).toMatchObject({
      delaySeconds: 5,
      data: { a: 1 },
    })
  })

  it('keeps the batch entries the model supplied', () => {
    const entries = [{ id: '1', data: { a: 1 } }]
    const merged = { ...CONNECTION, queueUrl: QUEUE_URL, entries }
    expect({ ...merged, ...mapParams(merged, { operation: 'send_message_batch' }) }).toMatchObject({
      entries,
    })
  })
})
