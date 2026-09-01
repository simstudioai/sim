/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateBillingUsageBySource,
  BILLING_USAGE_LOG_SOURCE_LABELS,
  toBillingUsageLogSource,
  toInternalUsageLogSources,
} from '@/lib/billing/usage-sources'

describe('billing usage sources', () => {
  it.each(['copilot', 'workspace-chat'] as const)(
    'presents the internal %s ledger as sim-chat',
    (source) => {
      expect(toBillingUsageLogSource(source)).toBe('sim-chat')
    }
  )

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

  it('uses the Sim Chat product name for billing display', () => {
    expect(BILLING_USAGE_LOG_SOURCE_LABELS['sim-chat']).toBe('Sim Chat')
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
