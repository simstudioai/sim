import { describe, expect, it } from 'vitest'
import {
  resolveEnterpriseReportingPeriod,
  resolveSubscriptionUsagePeriod,
  resolveSubscriptionUsagePeriodOrDefault,
} from '@/lib/billing/core/reporting-period'

describe('Enterprise reporting periods', () => {
  it('resolves a backdated annual contract anniversary', () => {
    expect(
      resolveEnterpriseReportingPeriod('2025-06-15', 'year', new Date('2026-08-13T12:00:00.000Z'))
    ).toMatchObject({
      start: new Date('2026-06-15T00:00:00.000Z'),
      end: new Date('2027-06-15T00:00:00.000Z'),
      source: 'reporting',
      anchorDate: '2025-06-15',
      interval: 'year',
    })
  })

  it('clamps monthly anniversaries to the last calendar day', () => {
    expect(
      resolveEnterpriseReportingPeriod('2026-01-31', 'month', new Date('2026-02-28T12:00:00.000Z'))
    ).toMatchObject({
      start: new Date('2026-02-28T00:00:00.000Z'),
      end: new Date('2026-03-31T00:00:00.000Z'),
    })
  })

  it('clamps leap-day annual anniversaries without drifting', () => {
    expect(
      resolveEnterpriseReportingPeriod('2024-02-29', 'year', new Date('2027-03-01T00:00:00.000Z'))
    ).toMatchObject({
      start: new Date('2027-02-28T00:00:00.000Z'),
      end: new Date('2028-02-29T00:00:00.000Z'),
    })
  })

  it('rolls to the next period at the exact end-exclusive anniversary', () => {
    expect(
      resolveEnterpriseReportingPeriod('2026-01-31', 'month', new Date('2026-03-31T00:00:00.000Z'))
    ).toMatchObject({
      start: new Date('2026-03-31T00:00:00.000Z'),
      end: new Date('2026-04-30T00:00:00.000Z'),
    })
  })

  it('falls back to the Stripe period when custom metadata is absent or future-dated', () => {
    const stripe = {
      plan: 'enterprise',
      billingInterval: 'year',
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2027-08-01T00:00:00.000Z'),
    }
    expect(resolveSubscriptionUsagePeriod(stripe)).toMatchObject({ source: 'stripe' })
    expect(
      resolveSubscriptionUsagePeriod(
        { ...stripe, metadata: { reportingPeriodAnchorDate: '2099-01-01' } },
        new Date('2026-08-13T00:00:00.000Z')
      )
    ).toMatchObject({ source: 'stripe' })
  })

  it('uses the same open fallback window when a subscription has no usable dates', () => {
    expect(
      resolveSubscriptionUsagePeriodOrDefault({ plan: 'enterprise', metadata: {} })
    ).toMatchObject({
      start: new Date(0),
      end: new Date(Date.UTC(9999, 11, 31)),
      source: 'default',
      anchorDate: null,
      interval: null,
    })
  })
})
