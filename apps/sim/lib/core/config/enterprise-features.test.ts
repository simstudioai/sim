import {
  ENTERPRISE_FEATURE_KEYS,
  ENTERPRISE_FEATURES,
  type EnterpriseFeature,
  resolveEnterpriseFeatures,
} from '@sim/deployment-config/enterprise-features'
import { describe, expect, it } from 'vitest'

interface Deployment {
  flags?: Partial<Record<EnterpriseFeature, boolean>>
  billingEnabled?: boolean
  hosted?: boolean
  masterEnabled?: boolean
}

function resolve({
  flags = {},
  billingEnabled = false,
  hosted = false,
  masterEnabled = false,
}: Deployment = {}) {
  const byEnvVar = new Map<string, boolean>(
    Object.entries(flags).map(([key, value]) => [
      ENTERPRISE_FEATURES[key as EnterpriseFeature].envVar,
      value,
    ])
  )
  return resolveEnterpriseFeatures({
    readFlag: (envVar) => byEnvVar.get(envVar),
    billingEnabled,
    hosted,
    masterEnabled,
  })
}

describe('resolveEnterpriseFeatures', () => {
  it('lets a feature flag win over an unset master switch', () => {
    expect(resolve({ flags: { auditLogs: true } }).auditLogs).toBe(true)
  })

  it('honors an explicit false inside an enabled suite', () => {
    const state = resolve({ masterEnabled: true, flags: { dataDrains: false, inbox: false } })

    expect(state.dataDrains).toBe(false)
    expect(state.inbox).toBe(false)
    expect(state.sso).toBe(true)
  })

  it('turns every feature on through the master switch without billing', () => {
    const state = resolve({ masterEnabled: true })

    for (const key of ENTERPRISE_FEATURE_KEYS) expect(state[key]).toBe(true)
  })

  it('keeps inbox and session policies on, and everything else off, with nothing configured', () => {
    const state = resolve()

    expect(ENTERPRISE_FEATURE_KEYS.filter((key) => state[key]).sort()).toEqual([
      'inbox',
      'sessionPolicies',
    ])
  })

  it('never widens access from the master switch or self-hosted defaults when billing runs', () => {
    const state = resolve({ billingEnabled: true, masterEnabled: true })

    expect(state.inbox).toBe(false)
    expect(state.sessionPolicies).toBe(false)
    expect(state.sso).toBe(false)
    expect(state.scim).toBe(false)
  })

  it('still honors an explicit flag when billing runs', () => {
    expect(resolve({ billingEnabled: true, flags: { sso: true } }).sso).toBe(true)
  })

  it('defaults SCIM on for the hosted platform and lets an explicit false defer it', () => {
    expect(resolve({ hosted: true, billingEnabled: true }).scim).toBe(true)
    expect(resolve({ hosted: true, billingEnabled: true, flags: { scim: false } }).scim).toBe(false)
  })

  it('keeps organizations on with billing, even over an explicit false', () => {
    expect(resolve({ billingEnabled: true, flags: { organizations: false } }).organizations).toBe(
      true
    )
  })

  it('turns organizations on with access control, even over an explicit false', () => {
    const state = resolve({ flags: { accessControl: true, organizations: false } })

    expect(state.organizations).toBe(true)
  })

  it('does not turn access control on from organizations', () => {
    expect(resolve({ flags: { organizations: true } }).accessControl).toBe(false)
  })
})
