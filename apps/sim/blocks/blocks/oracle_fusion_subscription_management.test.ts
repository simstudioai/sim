/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons', () => ({ NetSuiteIcon: () => null }))
vi.mock('@/lib/oauth/utils', () => ({ getScopesForService: () => [] }))

import { parseOracleFusionSubscriptionInput } from '@/lib/internal/oracle-fusion-subscription-management/schema'
import { buildSelectorContextFromValues } from '@/lib/selectors/context'
import {
  buildCanonicalIndex,
  isSubBlockVisibleForMode,
  resolveActiveCanonicalValue,
} from '@/lib/workflows/subblocks/visibility'
import { OracleFusionSubscriptionManagementBlock } from '@/blocks/blocks/oracle_fusion_subscription_management'

const block = OracleFusionSubscriptionManagementBlock
function mapped(name: string, values: Record<string, unknown>) {
  return {
    ...block.tools.config.params?.({
      operation: `oracle_fusion_subscription_management_${name}`,
      oauthCredential: 'credential-1',
      ...values,
    }),
    oauthCredential: 'credential-1',
    accessToken: 'test-token',
    instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
  }
}

describe('Subscription Management canonical block mapping', () => {
  it('keeps existing-key pickers visible through the unfiltered canonical index', () => {
    const index = buildCanonicalIndex(block.subBlocks)
    for (const canonical of ['subscriptionNumber', 'subscriptionProductPuid', 'coveredLevelPuid']) {
      const selector = block.subBlocks.find((field) => field.id === `${canonical}Selector`)!
      expect(index.groupsById[canonical].basicId).toBe(selector.id)
      expect(index.groupsById[canonical].advancedIds).toEqual([`${canonical}Manual`])
      expect(isSubBlockVisibleForMode(selector, false, index, {}, { [canonical]: 'basic' })).toBe(
        true
      )
    }
    const input = mapped('create_covered_level', {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      newCoveredLevelPuid: 'NEW-C-001',
      coveredLevelPuid: 'STALE-C-001',
      type: 'TENANT_COVERAGE_CODE',
      startDate: '2026-09-01',
    })
    expect(parseOracleFusionSubscriptionInput('create_covered_level', input)).toMatchObject({
      newCoveredLevelPuid: 'NEW-C-001',
    })
    expect(input).not.toHaveProperty('coveredLevelPuid')
  })

  it.each([
    'update_product',
    'create_covered_level',
    'update_covered_level',
    'create_associated_asset',
    'update_associated_asset',
  ])('keeps organization available only as item-picker context for %s', (name) => {
    const values = {
      operation: `oracle_fusion_subscription_management_${name}`,
      credential: 'credential-1',
      definitionOrganizationIdSelector: '123',
    }
    expect(
      buildSelectorContextFromValues({
        selectorKey: 'oracleFusionSubscriptionManagement.subscriptionItems',
        contextConfigs: block.subBlocks,
        values,
        dependsOn: ['oauthCredential', 'definitionOrganizationId'],
      })
    ).toEqual({ oauthCredential: 'credential-1', orgId: '123' })
    expect(mapped(name, { definitionOrganizationId: '123' })).not.toHaveProperty(
      'definitionOrganizationId'
    )
  })

  it('preserves exact resolved identifiers and drops stale lifecycle fields after operation changes', () => {
    const input = mapped('update_product', {
      subscriptionNumber: 'SUB / 001',
      subscriptionProductPuid: 'P-001',
      inventoryItemId: '9007199254740993',
      quantity: '0',
      suspendedDate: '2026-09-01',
      autoExtendFlag: 'true',
    })
    expect(parseOracleFusionSubscriptionInput('update_product', input)).toMatchObject({
      subscriptionNumber: 'SUB / 001',
      inventoryItemId: '9007199254740993',
      quantity: 0,
    })
    expect(input).not.toHaveProperty('suspendedDate')
    expect(input).not.toHaveProperty('autoExtendFlag')
  })

  it('keeps the selected/manual public identifier canonical and out of numeric coercion', () => {
    const index = buildCanonicalIndex(block.subBlocks)
    const members = block.subBlocks.filter(
      (field) => field.canonicalParamId === 'subscriptionNumber'
    )
    expect(members.map((field) => field.id)).toEqual([
      'subscriptionNumberSelector',
      'subscriptionNumberManual',
    ])
    expect(
      resolveActiveCanonicalValue(
        index.groupsById.subscriptionNumber,
        {
          subscriptionNumberSelector: 'SUB-OLD',
          subscriptionNumberManual: '<upstream.subscriptionNumber>',
          operation: 'oracle_fusion_subscription_management_get_subscription',
        },
        { subscriptionNumber: 'advanced' }
      )
    ).toBe('<upstream.subscriptionNumber>')
  })

  it('maps billing scope independently and removes inactive covered-level context', () => {
    const values = {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      coveredLevelPuid: 'C-001',
      limit: '25',
      totalResults: 'false',
    }
    const product = mapped('list_bill_lines', { ...values, billingScope: 'product' })
    expect(product).not.toHaveProperty('coveredLevelPuid')
    expect(parseOracleFusionSubscriptionInput('list_bill_lines', product)).toMatchObject({
      billingScope: 'product',
      limit: 25,
      totalResults: false,
    })
    const covered = mapped('list_bill_lines', { ...values, billingScope: 'covered_level' })
    expect(parseOracleFusionSubscriptionInput('list_bill_lines', covered)).toMatchObject({
      billingScope: 'covered_level',
      coveredLevelPuid: 'C-001',
    })
  })

  it('projects item selector organization dependencies from the active canonical field', () => {
    expect(
      buildSelectorContextFromValues({
        selectorKey: 'oracleFusionSubscriptionManagement.subscriptionItems',
        contextConfigs: block.subBlocks,
        values: {
          operation: 'oracle_fusion_subscription_management_create_product',
          credential: 'credential-1',
          definitionOrganizationIdSelector: '123',
          definitionOrganizationIdManual: '9007199254740993',
          instanceUrl: 'https://attacker.example',
        },
        canonicalModes: { definitionOrganizationId: 'advanced' },
        dependsOn: ['oauthCredential', 'definitionOrganizationId'],
      })
    ).toEqual({ oauthCredential: 'credential-1', orgId: '9007199254740993' })
  })

  it('distinguishes explicit false and invalid numbers from unset controls', () => {
    const values = { subscriptionNumber: 'SUB-001', subscriptionProductPuid: 'P-001' }
    expect(
      parseOracleFusionSubscriptionInput(
        'suspend_product',
        mapped('suspend_product', { ...values, autoExtendFlag: 'false', resumeDuration: '0' })
      )
    ).toMatchObject({ autoExtendFlag: false, resumeDuration: 0 })
    expect(() =>
      parseOracleFusionSubscriptionInput(
        'suspend_product',
        mapped('suspend_product', { ...values, resumeDuration: 'invalid' })
      )
    ).toThrow()
  })
})
