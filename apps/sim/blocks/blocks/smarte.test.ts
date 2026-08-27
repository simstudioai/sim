/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SmarteBlock } from '@/blocks/blocks/smarte'

function getToolParamsMapper() {
  const mapper = SmarteBlock.tools.config?.params
  if (!mapper) throw new Error('SMARTe block is missing its tool parameter mapper')
  return mapper
}

describe('SMARTe block tool mapping', () => {
  it('maps only inputs belonging to the selected operation', () => {
    expect(
      getToolParamsMapper()({
        operation: 'smarte_enrich_email',
        apiKey: 'key',
        e_fullName: 'Ada Lovelace',
        p_email: 'stale@example.com',
      })
    ).toEqual({ apiKey: 'key', fullName: 'Ada Lovelace' })
  })

  it('fails fast for invalid operations and unknown active inputs', () => {
    expect(() => getToolParamsMapper()({ operation: 'smarte_unknown' })).toThrow(
      'Invalid SMARTe operation'
    )
    expect(() =>
      getToolParamsMapper()({
        operation: 'smarte_enrich_email',
        e_unknown: 'value',
      })
    ).toThrow('Unknown SMARTe input')
  })
})
