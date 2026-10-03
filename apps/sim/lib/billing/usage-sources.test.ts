import { describe, expect, it } from 'vitest'
import {
  aggregateBillingUsageBySource,
  toBillingUsageLogSource,
  toInternalUsageLogSources,
} from '@/lib/billing/usage-sources'

describe('billing usage sources', () => {
  it('expands the sim-chat filter to both internal ledgers', () => {
    expect(toInternalUsageLogSources('sim-chat')).toEqual(['copilot', 'workspace-chat'])
  })

  it('combines both internal ledgers into one sim-chat total', () => {
    const result = aggregateBillingUsageBySource({
      workflow: 1.9,
      copilot: 0.4,
      'workspace-chat': 0.2,
    })

    expect(result.workflow).toBe(1.9)
    expect(result['sim-chat']).toBeCloseTo(0.6)
  })

  it('fails fast when a new internal ledger source has no public mapping', () => {
    expect(() =>
      Reflect.apply(aggregateBillingUsageBySource, undefined, [{ unexpected: 1 }])
    ).toThrow('Unknown internal usage log source: unexpected')
    expect(() => Reflect.apply(toBillingUsageLogSource, undefined, ['unexpected'])).toThrow(
      'Unknown internal usage log source: unexpected'
    )
    expect(() => Reflect.apply(toInternalUsageLogSources, undefined, ['unexpected'])).toThrow(
      'Unknown billing usage log source: unexpected'
    )
  })
})
