/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ENTERPRISE_FEATURE_LEGACY_DEFAULTS,
  type EnterpriseFeature,
  resolveEnterpriseEntitlement,
} from '@/lib/core/config/enterprise-entitlements'

describe('resolveEnterpriseEntitlement', () => {
  describe('precedence', () => {
    it('uses the feature flag when set, over the master switch', () => {
      expect(
        resolveEnterpriseEntitlement({ explicit: true, masterEnabled: false, legacyDefault: false })
      ).toBe(true)
    })

    it('honors an explicit false even when the master switch is on', () => {
      expect(
        resolveEnterpriseEntitlement({ explicit: false, masterEnabled: true, legacyDefault: true })
      ).toBe(false)
    })

    it('falls back to the master switch when the feature flag is unset', () => {
      expect(
        resolveEnterpriseEntitlement({
          explicit: undefined,
          masterEnabled: true,
          legacyDefault: false,
        })
      ).toBe(true)
    })

    it('falls back to the legacy default when nothing is configured', () => {
      expect(
        resolveEnterpriseEntitlement({
          explicit: undefined,
          masterEnabled: false,
          legacyDefault: true,
        })
      ).toBe(true)
      expect(
        resolveEnterpriseEntitlement({
          explicit: undefined,
          masterEnabled: false,
          legacyDefault: false,
        })
      ).toBe(false)
    })
  })

  describe('upgrade guarantee', () => {
    const features = Object.keys(ENTERPRISE_FEATURE_LEGACY_DEFAULTS) as EnterpriseFeature[]

    it('reproduces each feature legacy default when nothing is configured', () => {
      for (const feature of features) {
        expect(
          resolveEnterpriseEntitlement({
            explicit: undefined,
            masterEnabled: false,
            legacyDefault: ENTERPRISE_FEATURE_LEGACY_DEFAULTS[feature],
          })
        ).toBe(ENTERPRISE_FEATURE_LEGACY_DEFAULTS[feature])
      }
    })

    it('never turns a feature off that was previously on', () => {
      for (const feature of features) {
        const legacyDefault = ENTERPRISE_FEATURE_LEGACY_DEFAULTS[feature]
        if (!legacyDefault) continue
        expect(
          resolveEnterpriseEntitlement({ explicit: undefined, masterEnabled: true, legacyDefault })
        ).toBe(true)
      }
    })

    it('turns every feature on when the master switch is set', () => {
      for (const feature of features) {
        expect(
          resolveEnterpriseEntitlement({
            explicit: undefined,
            masterEnabled: true,
            legacyDefault: ENTERPRISE_FEATURE_LEGACY_DEFAULTS[feature],
          })
        ).toBe(true)
      }
    })
  })

  describe('legacy defaults', () => {
    it('keeps the features that were already reachable with billing off', () => {
      expect(ENTERPRISE_FEATURE_LEGACY_DEFAULTS.whitelabeling).toBe(true)
      expect(ENTERPRISE_FEATURE_LEGACY_DEFAULTS.sessionPolicies).toBe(true)
      expect(ENTERPRISE_FEATURE_LEGACY_DEFAULTS.inbox).toBe(true)
    })

    it('keeps destructive and previously unreachable features opt-in', () => {
      /**
       * Retention deletes data and audit logs could not be reached at all
       * before, so neither may switch on merely because a deployment upgraded.
       */
      expect(ENTERPRISE_FEATURE_LEGACY_DEFAULTS.dataRetention).toBe(false)
      expect(ENTERPRISE_FEATURE_LEGACY_DEFAULTS.auditLogs).toBe(false)
    })

    it('keeps the features that were closed behind their own flag closed', () => {
      expect(ENTERPRISE_FEATURE_LEGACY_DEFAULTS.dataDrains).toBe(false)
      expect(ENTERPRISE_FEATURE_LEGACY_DEFAULTS.forking).toBe(false)
      expect(ENTERPRISE_FEATURE_LEGACY_DEFAULTS.accessControl).toBe(false)
      expect(ENTERPRISE_FEATURE_LEGACY_DEFAULTS.organizations).toBe(false)
      expect(ENTERPRISE_FEATURE_LEGACY_DEFAULTS.sso).toBe(false)
    })
  })
})
