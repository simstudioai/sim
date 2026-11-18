import { describe, expect, it } from 'vitest'
import { DSPyBlock } from '@/blocks/blocks/dspy'

function mapParams(params: Record<string, unknown>) {
  const mapper = DSPyBlock.tools.config?.params
  if (!mapper) throw new Error('DSPy block has no params mapper')
  return mapper({ operation: 'predict', baseUrl: 'https://dspy.example.com', ...params })
}

describe('DSPy block params', () => {
  it('keeps Additional Inputs that an agent passes as an object', () => {
    expect(mapParams({ additionalInputs: { topic: 'billing' } }).additionalInputs).toEqual({
      topic: 'billing',
    })
  })

  it('fails on Additional Inputs that are not valid JSON instead of dropping them', () => {
    expect(() => mapParams({ additionalInputs: '{"topic": ' })).toThrow(
      'Additional Inputs must be valid JSON'
    )
  })

  it('fails on Additional Inputs that are JSON but not an object', () => {
    expect(() => mapParams({ additionalInputs: '["billing"]' })).toThrow(
      'Additional Inputs must be a JSON object'
    )
  })
})
