/**
 * @vitest-environment node
 */
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

/** Fields whose Wand output the prompt and the contract both describe as an array. */
const BATCH_ENTRY_FIELDS = ['sendEntries', 'deleteEntries', 'visibilityEntries'] as const

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

  it('forwards a whole number unchanged', () => {
    expect(
      mapParams({ ...CONNECTION, operation: 'send', queueUrl: QUEUE_URL, delaySeconds: '30' })
    ).toMatchObject({ delaySeconds: 30 })
  })

  it('treats a blank or whitespace-only field as unset', () => {
    for (const delaySeconds of ['', '   ']) {
      expect(
        mapParams({ ...CONNECTION, operation: 'send', queueUrl: QUEUE_URL, delaySeconds })
      ).not.toHaveProperty('delaySeconds')
    }
  })
})

describe('SQS block wand generation types', () => {
  it.each(BATCH_ENTRY_FIELDS)('generates a JSON array for %s', (fieldId) => {
    const subBlock = SQSBlock.subBlocks.find((candidate) => candidate.id === fieldId)

    expect(subBlock?.wandConfig?.generationType).toBe('json-array')
  })
})
