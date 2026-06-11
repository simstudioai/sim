/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SIM_RULE_DEFAULTS } from '@/lib/workspace-events/constants'
import { parseSubscriptionConfig } from '@/lib/workspace-events/subscriptions'

describe('parseSubscriptionConfig', () => {
  it('returns null for configs without a recognizable event type', () => {
    expect(parseSubscriptionConfig(null)).toBeNull()
    expect(parseSubscriptionConfig({})).toBeNull()
    expect(parseSubscriptionConfig({ eventType: 'bogus' })).toBeNull()
    expect(parseSubscriptionConfig('not-an-object')).toBeNull()
  })

  it('parses workflow ids from arrays and comma-separated strings', () => {
    expect(
      parseSubscriptionConfig({ eventType: 'execution_error', workflowIds: ['a', 'b', ''] })
        ?.workflowIds
    ).toEqual(['a', 'b'])
    expect(
      parseSubscriptionConfig({ eventType: 'execution_error', workflowIds: 'a, b,' })?.workflowIds
    ).toEqual(['a', 'b'])
  })

  it('treats a missing workflow selection as watching every workflow (empty list)', () => {
    expect(parseSubscriptionConfig({ eventType: 'execution_error' })?.workflowIds).toEqual([])
  })

  it('coerces numeric rule fields and falls back to defaults for invalid values', () => {
    const config = parseSubscriptionConfig({
      eventType: 'consecutive_failures',
      consecutiveFailures: '5',
      windowHours: 'not-a-number',
      costThresholdCredits: -2,
    })
    expect(config?.consecutiveFailures).toBe(5)
    expect(config?.windowHours).toBe(SIM_RULE_DEFAULTS.windowHours)
    expect(config?.costThresholdCredits).toBe(SIM_RULE_DEFAULTS.costThresholdCredits)
  })

  it('clamps rule fields to the legacy bounds (hot-path queries must stay bounded)', () => {
    const config = parseSubscriptionConfig({
      eventType: 'failure_rate',
      windowHours: 1_000_000,
      consecutiveFailures: 5000,
      failureRatePercent: 250,
      durationThresholdMs: 5,
      latencySpikePercent: 1,
      costThresholdCredits: 10_000_000,
      errorCountThreshold: 99999,
      inactivityHours: 0.01,
    })
    expect(config?.windowHours).toBe(168)
    expect(config?.consecutiveFailures).toBe(100)
    expect(config?.failureRatePercent).toBe(100)
    expect(config?.durationThresholdMs).toBe(1000)
    expect(config?.latencySpikePercent).toBe(10)
    expect(config?.costThresholdCredits).toBe(200_000)
    expect(config?.errorCountThreshold).toBe(1000)
    expect(config?.inactivityHours).toBe(1)
  })

  it('rounds fractional integer fields (counts feed SQL LIMIT) but keeps credits fractional', () => {
    const config = parseSubscriptionConfig({
      eventType: 'consecutive_failures',
      consecutiveFailures: '2.5',
      windowHours: 12.4,
      costThresholdCredits: 250.5,
    })
    expect(config?.consecutiveFailures).toBe(3)
    expect(config?.windowHours).toBe(12)
    expect(config?.costThresholdCredits).toBe(250.5)
  })
})
