/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  oracleFusionSubscriptionIdSchema,
  oracleFusionSubscriptionRuleIdSchema,
  parseOracleFusionSubscriptionInput,
} from '@/lib/internal/oracle-fusion-subscription-management/schema'

const AUTH = {
  oauthCredential: 'credential-1',
  accessToken: 'test-token',
  instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
}
const PRODUCT = { subscriptionNumber: 'SUB-001', subscriptionProductPuid: 'P-001' }

describe('Subscription Management input contracts', () => {
  it('requires the documented subscription create fields without exposing numeric parent IDs', () => {
    const input = {
      ...AUTH,
      newSubscriptionNumber: 'SUB-001',
      primaryPartyId: '9007199254740993',
      billToAccountId: '100',
      billToSiteUseId: '101',
      businessUnitId: '102',
      legalEntityId: '103',
      subscriptionProfileId: '104',
      definitionOrganizationId: '105',
      accountingRuleId: '-2',
      transactionTypeName: 'Invoice',
      currency: 'USD',
      partialPeriodStart: 'Service',
      partialPeriodType: 'Actual',
    }
    expect(parseOracleFusionSubscriptionInput('create_subscription', input)).toEqual(input)
    for (const key of Object.keys(input)) {
      const missing = Object.fromEntries(Object.entries(input).filter(([name]) => name !== key))
      expect(() => parseOracleFusionSubscriptionInput('create_subscription', missing)).toThrow()
    }
    expect(() =>
      parseOracleFusionSubscriptionInput('create_product', {
        ...AUTH,
        ...PRODUCT,
        subscriptionId: '999',
      })
    ).toThrow()
  })

  it('keeps exact IDs and signed rule IDs out of floating-point numbers', () => {
    expect(oracleFusionSubscriptionIdSchema.parse('9007199254740993')).toBe('9007199254740993')
    expect(oracleFusionSubscriptionRuleIdSchema.parse('-2')).toBe('-2')
    for (const value of [
      Number.MAX_SAFE_INTEGER + 1,
      '01',
      '1e3',
      '-2',
      '0',
      ' 12',
      '9223372036854775808',
    ]) {
      expect(oracleFusionSubscriptionIdSchema.safeParse(value).success).toBe(false)
    }
    expect(oracleFusionSubscriptionRuleIdSchema.safeParse('-9223372036854775809').success).toBe(
      false
    )
  })

  it('separates nullable updates, create-only fields, and lifecycle actions', () => {
    expect(
      parseOracleFusionSubscriptionInput('update_subscription', {
        ...AUTH,
        subscriptionNumber: 'SUB-001',
        description: null,
      })
    ).toHaveProperty('description', null)
    for (const patch of [{}, { status: 'ACTIVE' }, { primaryPartyId: '123' }]) {
      expect(() =>
        parseOracleFusionSubscriptionInput('update_subscription', {
          ...AUTH,
          subscriptionNumber: 'SUB-001',
          ...patch,
        })
      ).toThrow()
    }
    expect(() =>
      parseOracleFusionSubscriptionInput('update_associated_asset', {
        ...AUTH,
        ...PRODUCT,
        associatedAssetPuid: 'A-001',
        assetId: '123',
      })
    ).toThrow()
    expect(() =>
      parseOracleFusionSubscriptionInput('create_covered_level', {
        ...AUTH,
        ...PRODUCT,
        newCoveredLevelPuid: 'C-001',
        type: null,
        startDate: '2026-09-01',
      })
    ).toThrow()
  })

  it('validates dates without inventing provider code domains', () => {
    for (const startDate of ['2026-02-29', '2026-09-31', '09/01/2026']) {
      expect(() =>
        parseOracleFusionSubscriptionInput('update_product', { ...AUTH, ...PRODUCT, startDate })
      ).toThrow()
    }
    expect(
      parseOracleFusionSubscriptionInput('suspend_product', {
        ...AUTH,
        ...PRODUCT,
        suspendedDate: '2028-02-29',
        suspendReason: 'TENANT_REASON',
        resumeDuration: 0,
        autoExtendFlag: false,
      })
    ).toMatchObject({ resumeDuration: 0, autoExtendFlag: false })
    expect(() =>
      parseOracleFusionSubscriptionInput('update_product', {
        ...AUTH,
        ...PRODUCT,
        startDate: '2026-09-02',
        endDate: '2026-09-01',
      })
    ).toThrow()
  })

  it('distinguishes string warning flags and renewal output number from the route number', () => {
    expect(
      parseOracleFusionSubscriptionInput('renew_subscription', {
        ...AUTH,
        subscriptionNumber: 'SUB-001',
        newSubscriptionNumber: 'SUB-002',
        ignoreWarning: 'Y',
      })
    ).toMatchObject({ subscriptionNumber: 'SUB-001', newSubscriptionNumber: 'SUB-002' })
    for (const fields of [{ ignoreWarnings: false }, { ignoreWarning: 'Y' }]) {
      expect(() =>
        parseOracleFusionSubscriptionInput('activate_subscription', {
          ...AUTH,
          subscriptionNumber: 'SUB-001',
          ...fields,
        })
      ).toThrow()
    }
  })

  it('requires an explicit covered-level scope and rejects redundant conflicting parents', () => {
    for (const operation of ['list_charges', 'list_bill_lines', 'create_charge_adjustment']) {
      const extra = operation === 'create_charge_adjustment' ? { chargePuid: 'CH-001' } : {}
      for (const scope of [
        { billingScope: 'covered_level' },
        { billingScope: 'product', coveredLevelPuid: 'C-001' },
        { billingScope: 'subscription' },
        { subscriptionProductId: '999' },
      ]) {
        expect(() =>
          parseOracleFusionSubscriptionInput(operation, { ...AUTH, ...PRODUCT, ...extra, ...scope })
        ).toThrow()
      }
    }
  })

  it('bounds pages and rejects unknown operations and unsafe resource keys', () => {
    for (const page of [
      { limit: 101 },
      { limit: 0 },
      { offset: -1 },
      { offset: Number.MAX_SAFE_INTEGER },
    ]) {
      expect(() =>
        parseOracleFusionSubscriptionInput('list_subscriptions', { ...AUTH, ...page })
      ).toThrow()
    }
    for (const key of ['https://other.example/path', '..', ' leading', '\u0000']) {
      expect(() =>
        parseOracleFusionSubscriptionInput('get_subscription_profile', {
          ...AUTH,
          subscriptionProfileKey: key,
        })
      ).toThrow()
    }
    for (const operation of ['constructor', 'toString', 'update_bill_line']) {
      expect(() => parseOracleFusionSubscriptionInput(operation, AUTH)).toThrow()
    }
  })
})
