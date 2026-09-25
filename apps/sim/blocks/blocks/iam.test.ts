import { describe, expect, it } from 'vitest'
import { IAMBlock } from '@/blocks/blocks/iam'

const SHAPE_ERROR =
  'Condition Context Keys must be a JSON array of { contextKeyName, contextKeyValues, contextKeyType }'

const CONTEXT_ENTRY = {
  contextKeyName: 'aws:SourceIp',
  contextKeyValues: ['203.0.113.10'],
  contextKeyType: 'ip',
}

function simulateParams(extra: Record<string, unknown>) {
  return IAMBlock.tools.config!.params!({
    operation: 'simulate_principal_policy',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'secret',
    policySourceArn: 'arn:aws:iam::000000000000:role/example',
    actionNames: 's3:GetObject',
    ...extra,
  })
}

describe('IAMBlock contextEntries parsing', () => {
  it('passes a JSON array string through as parsed context entries', () => {
    const result = simulateParams({ contextEntries: JSON.stringify([CONTEXT_ENTRY]) })
    expect(result.contextEntries).toEqual([CONTEXT_ENTRY])
  })

  it('rejects a JSON object rather than silently simulating without the context keys', () => {
    expect(() => simulateParams({ contextEntries: JSON.stringify(CONTEXT_ENTRY) })).toThrow(
      SHAPE_ERROR
    )
  })

  it('rejects a JSON scalar rather than silently dropping it', () => {
    expect(() => simulateParams({ contextEntries: '"aws:SourceIp"' })).toThrow(SHAPE_ERROR)
    expect(() => simulateParams({ contextEntries: '42' })).toThrow(SHAPE_ERROR)
  })

  it('rejects malformed JSON with the same shape message', () => {
    expect(() => simulateParams({ contextEntries: '{not json' })).toThrow(SHAPE_ERROR)
  })

  it('omits contextEntries for an empty JSON array without throwing', () => {
    const result = simulateParams({ contextEntries: '[]' })
    expect(result.contextEntries).toBeUndefined()
  })
})
