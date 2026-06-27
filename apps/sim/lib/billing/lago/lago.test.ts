/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('lago external ids (legacy)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('round-trips user and organization ids without product slug', async () => {
    vi.stubEnv('LAGO_PRODUCT_SLUG', '')
    vi.resetModules()
    const { fromLagoCustomerExternalId, toLagoCustomerExternalId } = await import(
      '@/lib/billing/lago/external-ids'
    )

    expect(toLagoCustomerExternalId('user', 'user_123')).toBe('user:user_123')
    expect(toLagoCustomerExternalId('organization', 'org_abc')).toBe('org:org_abc')

    expect(fromLagoCustomerExternalId('user:user_123')).toEqual({
      entityType: 'user',
      entityId: 'user_123',
    })
    expect(fromLagoCustomerExternalId('org:org_abc')).toEqual({
      entityType: 'organization',
      entityId: 'org_abc',
    })
  })
})

describe('lago external ids (aacworkflow)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses plain customer ids and product-prefixed subscription ids', async () => {
    vi.stubEnv('LAGO_PRODUCT_SLUG', 'aacworkflow')
    vi.resetModules()
    const {
      fromLagoCustomerExternalId,
      fromLagoSubscriptionExternalId,
      toLagoCustomerExternalId,
      toLagoSubscriptionExternalId,
    } = await import('@/lib/billing/lago/external-ids')

    expect(toLagoCustomerExternalId('user', 'user_123')).toBe('user_123')
    expect(toLagoSubscriptionExternalId('user', 'user_123')).toBe('aacworkflow:user_123')

    expect(fromLagoCustomerExternalId('user_123')).toEqual({
      entityType: 'user',
      entityId: 'user_123',
    })
    expect(fromLagoSubscriptionExternalId('aacworkflow:org_abc')).toEqual({
      entityType: 'organization',
      entityId: 'org_abc',
    })
  })
})

describe('lago plan mapping', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('maps default plan codes to sim plan names', async () => {
    vi.stubEnv('LAGO_PRODUCT_SLUG', '')
    vi.resetModules()
    const { mapLagoPlanToSimPlan, mapSimPlanToLagoPlan } = await import('@/lib/billing/lago/config')

    expect(mapLagoPlanToSimPlan('sim_pro_6000')).toBe('pro_6000')
    expect(mapSimPlanToLagoPlan('pro_6000')).toBe('sim_pro_6000')
  })

  it('maps aacworkflow_free to free tier', async () => {
    vi.stubEnv('LAGO_PRODUCT_SLUG', 'aacworkflow')
    vi.resetModules()
    const { mapLagoPlanToSimPlan } = await import('@/lib/billing/lago/config')

    expect(mapLagoPlanToSimPlan('aacworkflow_free')).toBe('free')
    expect(mapLagoPlanToSimPlan('aacworkflow_payg')).toBe('free')
  })
})
