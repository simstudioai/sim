/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildHostedUpgradeUrl,
  buildUpgradeHref,
  HOSTED_BILLING_SETTINGS_URL,
  isUpgradeReason,
  UPGRADE_REASON_COPY,
  UPGRADE_REASONS,
} from '@/lib/billing/upgrade-reasons'

describe('upgrade-reasons', () => {
  it('has copy for every reason', () => {
    for (const reason of UPGRADE_REASONS) {
      const copy = UPGRADE_REASON_COPY[reason]
      expect(copy.header).toMatch(/^Upgrade to scale/)
      expect(copy.noun.length).toBeGreaterThan(0)
      expect(copy.warningSubject.length).toBeGreaterThan(0)
      expect(copy.reachedSubject.length).toBeGreaterThan(0)
    }
  })

  it('uses Emir’s header wording', () => {
    expect(UPGRADE_REASON_COPY.seats.header).toBe('Upgrade to scale with your teammates')
    expect(UPGRADE_REASON_COPY.tables.header).toBe('Upgrade to scale your tables')
    expect(UPGRADE_REASON_COPY.storage.header).toBe('Upgrade to scale your storage')
  })

  it('builds hrefs with and without a reason', () => {
    expect(buildUpgradeHref('ws-1')).toBe('/workspace/ws-1/upgrade')
    expect(buildUpgradeHref('ws-1', 'tables')).toBe('/workspace/ws-1/upgrade?reason=tables')
  })

  it('builds absolute hosted URLs for self-hosted deployments', () => {
    expect(buildHostedUpgradeUrl()).toBe('https://www.sim.ai/upgrade')
    expect(buildHostedUpgradeUrl('credits')).toBe('https://www.sim.ai/upgrade?reason=credits')
    expect(HOSTED_BILLING_SETTINGS_URL).toBe('https://www.sim.ai/account/settings/billing')
  })

  it('guards known reasons', () => {
    expect(isUpgradeReason('storage')).toBe(true)
    expect(isUpgradeReason('seats')).toBe(true)
    expect(isUpgradeReason('bogus')).toBe(false)
    expect(isUpgradeReason(null)).toBe(false)
  })
})
