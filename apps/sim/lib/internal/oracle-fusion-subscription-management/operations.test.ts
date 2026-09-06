/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ json: vi.fn(), empty: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.json,
  requestOracleFusionEmpty: mocks.empty,
}))

import type { OracleFusionRequest } from '@/lib/internal/oracle-fusion/client'
import { serializeOracleFusionJsonBody } from '@/lib/internal/oracle-fusion/request-body'
import {
  executeOracleFusionSubscriptionOperation,
  listOracleFusionSubscriptionRecords,
} from '@/lib/internal/oracle-fusion-subscription-management/operations'

const AUTH = {
  oauthCredential: 'credential-1',
  accessToken: 'test-token',
  instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
}
const ROOT = `${AUTH.instanceUrl}/crmRestApi/resources/11.13.18.05/`
const PRODUCT = { subscriptionNumber: 'SUB-001', subscriptionProductPuid: 'P-001' }
const PRODUCT_PATH = 'subscriptions/SUB-001/child/products/P-001'

function record(path: string, extra: Record<string, unknown> = {}) {
  return {
    SubscriptionNumber: 'SUB-001',
    SubscriptionId: '123',
    SubscriptionProductPuid: 'P-001',
    SubscriptionProductId: '456',
    CoveredLevelPuid: 'C-001',
    CoveredLevelId: '678',
    AssociatedAssetPuid: 'A-001',
    ChargePuid: 'CH-001',
    ChargeId: '789',
    ChargeAdjustmentPuid: 'ADJ-001',
    BillLinePuid: 'B-001',
    BillAdjustmentPuid: 'BA-001',
    '@context': { links: [{ rel: 'self', href: ROOT + path }] },
    UnpublishedField: 'private-canary',
    ...extra,
  }
}

interface RequestFixture {
  name: string
  kind: string
  entity: string
  key: string
  input: Record<string, unknown>
  body?: Record<string, unknown>
  path: string
  method: string
  result?: string
}

// Fixed request fixtures transcribed from the public CRM 11.13.18.05 endpoint contracts.
const REQUESTS: RequestFixture[] = [
  {
    name: 'list_subscriptions',
    kind: 'list',
    entity: 'subscription',
    key: 'SUB-001',
    input: {},
    path: 'subscriptions',
    method: 'GET',
  },
  {
    name: 'get_subscription',
    kind: 'get',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
    },
    path: 'subscriptions/SUB-001',
    method: 'GET',
  },
  {
    name: 'create_subscription',
    kind: 'create',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      newSubscriptionNumber: 'SUB-001',
      primaryPartyId: '123',
      billToAccountId: '123',
      billToSiteUseId: '123',
      businessUnitId: '123',
      legalEntityId: '123',
      subscriptionProfileId: '123',
      definitionOrganizationId: '123',
      accountingRuleId: '-2',
      transactionTypeName: 'EXAMPLE',
      currency: 'EXAMPLE',
      partialPeriodStart: 'EXAMPLE',
      partialPeriodType: 'EXAMPLE',
    },
    body: {
      SubscriptionNumber: 'SUB-001',
      PrimaryPartyId: 123,
      BillToAccountId: 123,
      BillToSiteUseId: 123,
      BusinessUnitId: 123,
      LegalEntityId: 123,
      SubscriptionProfileId: 123,
      DefinitionOrganizationId: 123,
      AccountingRuleId: -2,
      TransactionTypeName: 'EXAMPLE',
      Currency: 'EXAMPLE',
      PartialPeriodStart: 'EXAMPLE',
      PartialPeriodType: 'EXAMPLE',
    },
    path: 'subscriptions',
    method: 'POST',
  },
  {
    name: 'update_subscription',
    kind: 'update',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
      description: 'EXAMPLE',
    },
    body: {
      Description: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001',
    method: 'PATCH',
  },
  {
    name: 'delete_subscription',
    kind: 'delete',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
    },
    path: 'subscriptions/SUB-001',
    method: 'DELETE',
  },
  {
    name: 'list_products',
    kind: 'list',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
    },
    path: 'subscriptions/SUB-001/child/products',
    method: 'GET',
  },
  {
    name: 'get_product',
    kind: 'get',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001',
    method: 'GET',
  },
  {
    name: 'create_product',
    kind: 'create',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      newSubscriptionProductPuid: 'P-001',
      lineNumber: 'EXAMPLE',
      inventoryItemId: '123',
      definitionOrganizationId: '123',
      accountingRuleId: '-2',
      invoicingRuleId: '-2',
      billToAccountId: '123',
      billToSiteUseId: '123',
      billingFrequency: 'EXAMPLE',
      currency: 'EXAMPLE',
      transactionTypeName: 'EXAMPLE',
      startDate: '2026-09-01',
    },
    body: {
      SubscriptionProductPuid: 'P-001',
      LineNumber: 'EXAMPLE',
      InventoryItemId: 123,
      DefinitionOrganizationId: 123,
      AccountingRuleId: -2,
      InvoicingRuleId: -2,
      BillToAccountId: 123,
      BillToSiteUseId: 123,
      BillingFrequency: 'EXAMPLE',
      Currency: 'EXAMPLE',
      TransactionTypeName: 'EXAMPLE',
      StartDate: '2026-09-01',
      SubscriptionId: 123,
    },
    path: 'subscriptions/SUB-001/child/products',
    method: 'POST',
  },
  {
    name: 'update_product',
    kind: 'update',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      inventoryItemId: '123',
    },
    body: {
      InventoryItemId: 123,
    },
    path: 'subscriptions/SUB-001/child/products/P-001',
    method: 'PATCH',
  },
  {
    name: 'delete_product',
    kind: 'delete',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001',
    method: 'DELETE',
  },
  {
    name: 'list_covered_levels',
    kind: 'list',
    entity: 'coveredLevel',
    key: 'C-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/coveredLevels',
    method: 'GET',
  },
  {
    name: 'get_covered_level',
    kind: 'get',
    entity: 'coveredLevel',
    key: 'C-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      coveredLevelPuid: 'C-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/coveredLevels/C-001',
    method: 'GET',
  },
  {
    name: 'create_covered_level',
    kind: 'create',
    entity: 'coveredLevel',
    key: 'C-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      newCoveredLevelPuid: 'C-001',
      type: 'EXAMPLE',
      startDate: '2026-09-01',
    },
    body: {
      CoveredLevelPuid: 'C-001',
      Type: 'EXAMPLE',
      StartDate: '2026-09-01',
      SubscriptionId: 123,
      SubscriptionProductId: 456,
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/coveredLevels',
    method: 'POST',
  },
  {
    name: 'update_covered_level',
    kind: 'update',
    entity: 'coveredLevel',
    key: 'C-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      coveredLevelPuid: 'C-001',
      startDate: '2026-09-01',
    },
    body: {
      StartDate: '2026-09-01',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/coveredLevels/C-001',
    method: 'PATCH',
  },
  {
    name: 'delete_covered_level',
    kind: 'delete',
    entity: 'coveredLevel',
    key: 'C-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      coveredLevelPuid: 'C-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/coveredLevels/C-001',
    method: 'DELETE',
  },
  {
    name: 'list_associated_assets',
    kind: 'list',
    entity: 'associatedAsset',
    key: 'A-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/associatedAsset',
    method: 'GET',
  },
  {
    name: 'get_associated_asset',
    kind: 'get',
    entity: 'associatedAsset',
    key: 'A-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      associatedAssetPuid: 'A-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/associatedAsset/A-001',
    method: 'GET',
  },
  {
    name: 'create_associated_asset',
    kind: 'create',
    entity: 'associatedAsset',
    key: 'A-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
    },
    body: {
      SubscriptionId: 123,
      SubscriptionProductId: 456,
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/associatedAsset',
    method: 'POST',
  },
  {
    name: 'update_associated_asset',
    kind: 'update',
    entity: 'associatedAsset',
    key: 'A-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      associatedAssetPuid: 'A-001',
      assetName: 'EXAMPLE',
    },
    body: {
      AssetName: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/associatedAsset/A-001',
    method: 'PATCH',
  },
  {
    name: 'delete_associated_asset',
    kind: 'delete',
    entity: 'associatedAsset',
    key: 'A-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      associatedAssetPuid: 'A-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/associatedAsset/A-001',
    method: 'DELETE',
  },
  {
    name: 'list_charges',
    kind: 'list',
    entity: 'charge',
    key: 'CH-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/charges',
    method: 'GET',
  },
  {
    name: 'get_charge',
    kind: 'get',
    entity: 'charge',
    key: 'CH-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      chargePuid: 'CH-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/charges/CH-001',
    method: 'GET',
  },
  {
    name: 'create_charge',
    kind: 'create',
    entity: 'charge',
    key: 'CH-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      priceType: 'EXAMPLE',
    },
    body: {
      PriceType: 'EXAMPLE',
      SubscriptionId: 123,
      SubscriptionProductId: 456,
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/charges',
    method: 'POST',
  },
  {
    name: 'update_charge',
    kind: 'update',
    entity: 'charge',
    key: 'CH-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      chargePuid: 'CH-001',
      chargeName: 'EXAMPLE',
    },
    body: {
      ChargeName: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/charges/CH-001',
    method: 'PATCH',
  },
  {
    name: 'delete_charge',
    kind: 'delete',
    entity: 'charge',
    key: 'CH-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      chargePuid: 'CH-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/charges/CH-001',
    method: 'DELETE',
  },
  {
    name: 'list_charge_adjustments',
    kind: 'list',
    entity: 'chargeAdjustment',
    key: 'ADJ-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      chargePuid: 'CH-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/charges/CH-001/child/adjustments',
    method: 'GET',
  },
  {
    name: 'get_charge_adjustment',
    kind: 'get',
    entity: 'chargeAdjustment',
    key: 'ADJ-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      chargePuid: 'CH-001',
      chargeAdjustmentPuid: 'ADJ-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/charges/CH-001/child/adjustments/ADJ-001',
    method: 'GET',
  },
  {
    name: 'create_charge_adjustment',
    kind: 'create',
    entity: 'chargeAdjustment',
    key: 'ADJ-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      chargePuid: 'CH-001',
    },
    body: {
      SubscriptionId: 123,
      SubscriptionProductId: 456,
      ChargeId: 789,
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/charges/CH-001/child/adjustments',
    method: 'POST',
  },
  {
    name: 'update_charge_adjustment',
    kind: 'update',
    entity: 'chargeAdjustment',
    key: 'ADJ-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      chargePuid: 'CH-001',
      chargeAdjustmentPuid: 'ADJ-001',
      adjustmentName: 'EXAMPLE',
    },
    body: {
      AdjustmentName: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/charges/CH-001/child/adjustments/ADJ-001',
    method: 'PATCH',
  },
  {
    name: 'delete_charge_adjustment',
    kind: 'delete',
    entity: 'chargeAdjustment',
    key: 'ADJ-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      chargePuid: 'CH-001',
      chargeAdjustmentPuid: 'ADJ-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/charges/CH-001/child/adjustments/ADJ-001',
    method: 'DELETE',
  },
  {
    name: 'list_bill_lines',
    kind: 'list',
    entity: 'billLine',
    key: 'B-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/billLines',
    method: 'GET',
  },
  {
    name: 'get_bill_line',
    kind: 'get',
    entity: 'billLine',
    key: 'B-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      billLinePuid: 'B-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/billLines/B-001',
    method: 'GET',
  },
  {
    name: 'list_bill_adjustments',
    kind: 'list',
    entity: 'billAdjustment',
    key: 'BA-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      billLinePuid: 'B-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/billLines/B-001/child/billAdjustments',
    method: 'GET',
  },
  {
    name: 'get_bill_adjustment',
    kind: 'get',
    entity: 'billAdjustment',
    key: 'BA-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      billLinePuid: 'B-001',
      billAdjustmentPuid: 'BA-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/billLines/B-001/child/billAdjustments/BA-001',
    method: 'GET',
  },
  {
    name: 'list_validation_results',
    kind: 'list',
    entity: 'validationResult',
    key: 'opaque-hash',
    input: {
      subscriptionNumber: 'SUB-001',
    },
    path: 'subscriptions/SUB-001/child/validateSubscription',
    method: 'GET',
  },
  {
    name: 'get_validation_result',
    kind: 'get',
    entity: 'validationResult',
    key: 'opaque-hash',
    input: {
      subscriptionNumber: 'SUB-001',
      validationResultKey: 'opaque-hash',
    },
    path: 'subscriptions/SUB-001/child/validateSubscription/opaque-hash',
    method: 'GET',
  },
  {
    name: 'list_subscription_profiles',
    kind: 'list',
    entity: 'subscriptionProfile',
    key: 'opaque-hash',
    input: {},
    path: 'subscriptionProfiles',
    method: 'GET',
  },
  {
    name: 'get_subscription_profile',
    kind: 'get',
    entity: 'subscriptionProfile',
    key: 'opaque-hash',
    input: {
      subscriptionProfileKey: 'opaque-hash',
    },
    path: 'subscriptionProfiles/opaque-hash',
    method: 'GET',
  },
  {
    name: 'list_subscription_items',
    kind: 'list',
    entity: 'subscriptionItem',
    key: 'opaque-hash',
    input: {},
    path: 'subscriptionItems',
    method: 'GET',
  },
  {
    name: 'get_subscription_item',
    kind: 'get',
    entity: 'subscriptionItem',
    key: 'opaque-hash',
    input: {
      subscriptionItemKey: 'opaque-hash',
    },
    path: 'subscriptionItems/opaque-hash',
    method: 'GET',
  },
  {
    name: 'list_subscription_assets',
    kind: 'list',
    entity: 'subscriptionAsset',
    key: 'opaque-hash',
    input: {},
    path: 'subscriptionAssets',
    method: 'GET',
  },
  {
    name: 'get_subscription_asset',
    kind: 'get',
    entity: 'subscriptionAsset',
    key: 'opaque-hash',
    input: {
      subscriptionAssetKey: 'opaque-hash',
    },
    path: 'subscriptionAssets/opaque-hash',
    method: 'GET',
  },
  {
    name: 'list_child_covered_levels',
    kind: 'list',
    entity: 'childCoveredLevel',
    key: 'C-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      coveredLevelPuid: 'C-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/coveredLevels/C-001/child/childCoveredLevels',
    method: 'GET',
  },
  {
    name: 'get_child_covered_level',
    kind: 'get',
    entity: 'childCoveredLevel',
    key: 'C-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      coveredLevelPuid: 'C-001',
      childCoveredLevelPuid: 'C-001',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/child/coveredLevels/C-001/child/childCoveredLevels/C-001',
    method: 'GET',
  },
  {
    name: 'activate_subscription',
    kind: 'action',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
      ignoreWarnings: 'EXAMPLE',
    },
    body: {
      ignoreWarnings: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/action/activate',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'cancel_subscription',
    kind: 'action',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
      canceledDate: '2026-09-01',
      cancelDescription: 'EXAMPLE',
      cancelReason: 'EXAMPLE',
    },
    body: {
      canceledDate: '2026-09-01',
      cancelDescription: 'EXAMPLE',
      cancelReason: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/action/cancel',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'close_subscription',
    kind: 'action',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
      closeDescription: 'EXAMPLE',
      closedDate: '2026-09-01',
      overrideCreditAmount: 0,
      closeCreditMethod: 'EXAMPLE',
      revenueOption: 'EXAMPLE',
      balanceTerminatedPartialPeriodOption: 'EXAMPLE',
      closeReason: 'EXAMPLE',
      creditType: 'EXAMPLE',
    },
    body: {
      closeDescription: 'EXAMPLE',
      closedDate: '2026-09-01',
      overrideCreditAmount: 0,
      closeCreditMethod: 'EXAMPLE',
      revenueOption: 'EXAMPLE',
      balanceTerminatedPartialPeriodOption: 'EXAMPLE',
      closeReason: 'EXAMPLE',
      creditType: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/action/close',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'hold_subscription',
    kind: 'action',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
    },
    body: {},
    path: 'subscriptions/SUB-001/action/putOnHold',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'remove_subscription_hold',
    kind: 'action',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
    },
    body: {},
    path: 'subscriptions/SUB-001/action/removeHold',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'renew_subscription',
    kind: 'action',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
      duration: 0,
      period: 'EXAMPLE',
      newSubscriptionNumber: 'EXAMPLE',
      revenueOption: 'EXAMPLE',
      ignoreWarning: 'EXAMPLE',
      revenueAction: 'EXAMPLE',
    },
    body: {
      duration: 0,
      period: 'EXAMPLE',
      subscriptionNumber: 'EXAMPLE',
      revenueOption: 'EXAMPLE',
      ignoreWarning: 'EXAMPLE',
      revenueAction: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/action/renew',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'validate_subscription',
    kind: 'action',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
      ignoreWarnings: 'EXAMPLE',
    },
    body: {
      ignoreWarnings: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/action/submitValidation',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'withdraw_subscription',
    kind: 'action',
    entity: 'subscription',
    key: 'SUB-001',
    input: {
      subscriptionNumber: 'SUB-001',
    },
    body: {},
    path: 'subscriptions/SUB-001/action/withdraw',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'amend_product',
    kind: 'action',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      copyCustomChildObjects: 'EXAMPLE',
      amendCreditMethod: 'EXAMPLE',
      defaultRevenueAction: 'EXAMPLE',
      copyCharges: 'EXAMPLE',
      copyAdjustments: 'EXAMPLE',
      creditType: 'EXAMPLE',
      amendDescription: 'EXAMPLE',
      amendReason: 'EXAMPLE',
      overrideCreditAmount: 0,
      copyOneTimeCharges: 'EXAMPLE',
      revenueOption: 'EXAMPLE',
      balanceTermLineTerminatedPartialPeriodOption: 'EXAMPLE',
      lineNumber: 'EXAMPLE',
      amendEffectiveDate: '2026-09-01',
      balanceNewLineFirstPartialPeriodOption: 'EXAMPLE',
    },
    body: {
      copyCustomChildObjects: 'EXAMPLE',
      amendCreditMethod: 'EXAMPLE',
      defaultRevenueAction: 'EXAMPLE',
      copyCharges: 'EXAMPLE',
      copyAdjustments: 'EXAMPLE',
      creditType: 'EXAMPLE',
      amendDescription: 'EXAMPLE',
      amendReason: 'EXAMPLE',
      overrideCreditAmount: 0,
      copyOneTimeCharges: 'EXAMPLE',
      revenueOption: 'EXAMPLE',
      balanceTermLineTerminatedPartialPeriodOption: 'EXAMPLE',
      lineNumber: 'EXAMPLE',
      amendEffectiveDate: '2026-09-01',
      balanceNewLineFirstPartialPeriodOption: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/action/amend',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'calculate_product_credit',
    kind: 'action',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      closedDate: '2026-09-01',
      closeCreditMethod: 'EXAMPLE',
      coveredLevelPuid: 'EXAMPLE',
      externalAssetKey: 'EXAMPLE',
    },
    body: {
      closedDate: '2026-09-01',
      closeCreditMethod: 'EXAMPLE',
      coveredLevelPuid: 'EXAMPLE',
      externalAssetKey: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/action/calculateCreditAmount',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'calculate_product_termination_fee',
    kind: 'action',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      closedDate: '2026-09-01',
    },
    body: {
      closedDate: '2026-09-01',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/action/calculateEarlyTerminationFee',
    method: 'POST',
    result: 'number',
  },
  {
    name: 'cancel_product',
    kind: 'action',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      canceledDate: '2026-09-01',
      cancelDescription: 'EXAMPLE',
      cancelReason: 'EXAMPLE',
    },
    body: {
      canceledDate: '2026-09-01',
      cancelDescription: 'EXAMPLE',
      cancelReason: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/action/cancel',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'close_product',
    kind: 'action',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      closeDescription: 'EXAMPLE',
      closedDate: '2026-09-01',
      overrideCreditAmount: 0,
      closeCreditMethod: 'EXAMPLE',
      revenueOption: 'EXAMPLE',
      balanceTerminatedPartialPeriodOption: 'EXAMPLE',
      earlyTerminationFee: 0,
      closeReason: 'EXAMPLE',
      creditType: 'EXAMPLE',
    },
    body: {
      closeDescription: 'EXAMPLE',
      closedDate: '2026-09-01',
      overrideCreditAmount: 0,
      closeCreditMethod: 'EXAMPLE',
      revenueOption: 'EXAMPLE',
      balanceTerminatedPartialPeriodOption: 'EXAMPLE',
      earlyTerminationFee: 0,
      closeReason: 'EXAMPLE',
      creditType: 'EXAMPLE',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/action/close',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'hold_product',
    kind: 'action',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
    },
    body: {},
    path: 'subscriptions/SUB-001/child/products/P-001/action/putOnHold',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'remove_product_hold',
    kind: 'action',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
    },
    body: {},
    path: 'subscriptions/SUB-001/child/products/P-001/action/removeHold',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'resume_product',
    kind: 'action',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      resumePeriod: 'EXAMPLE',
      resumeDuration: 0,
      autoExtendFlag: false,
      resumeDate: '2026-09-01',
    },
    body: {
      resumePeriod: 'EXAMPLE',
      resumeDuration: 0,
      autoExtendFlag: false,
      resumeDate: '2026-09-01',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/action/resume',
    method: 'POST',
    result: 'string',
  },
  {
    name: 'suspend_product',
    kind: 'action',
    entity: 'product',
    key: 'P-001',
    input: {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
      suspendReason: 'EXAMPLE',
      resumePeriod: 'EXAMPLE',
      resumeDuration: 0,
      suspendedDate: '2026-09-01',
      autoExtendFlag: false,
      resumeDate: '2026-09-01',
    },
    body: {
      suspendReason: 'EXAMPLE',
      resumePeriod: 'EXAMPLE',
      resumeDuration: 0,
      suspendedDate: '2026-09-01',
      autoExtendFlag: false,
      resumeDate: '2026-09-01',
    },
    path: 'subscriptions/SUB-001/child/products/P-001/action/suspend',
    method: 'POST',
    result: 'string',
  },
]

describe('Subscription Management provider contracts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.empty.mockResolvedValue(undefined)
  })

  it.each(REQUESTS)('$name uses its exact public request and projected response', async (entry) => {
    const itemPath =
      entry.kind === 'list' || entry.kind === 'create' ? `${entry.path}/${entry.key}` : entry.path
    const item = record(itemPath)
    mocks.json.mockImplementation(async (_credential, request: OracleFusionRequest) => {
      if (entry.kind === 'create' && (request.method ?? 'GET') === 'GET') {
        return record(request.address.relativePath)
      }
      if (entry.kind === 'action')
        return { result: entry.result === 'number' ? 12.5 : 'Successful' }
      if (entry.kind === 'list') {
        return { items: [item], count: 1, limit: 50, offset: 0, hasMore: false }
      }
      return item
    })
    const response = await executeOracleFusionSubscriptionOperation(entry.name, {
      ...AUTH,
      ...entry.input,
    })
    const calls = entry.kind === 'delete' ? mocks.empty.mock.calls : mocks.json.mock.calls
    const request = calls[calls.length - 1][1] as OracleFusionRequest
    expect(request.address).toEqual({ family: 'crm', relativePath: entry.path })
    expect(request.method ?? 'GET').toBe(entry.method)
    if (entry.body) {
      expect(JSON.parse(serializeOracleFusionJsonBody(request.body))).toEqual(entry.body)
      expect(request.mediaType).toBe(
        entry.kind === 'action'
          ? 'application/vnd.oracle.adf.action+json'
          : 'application/vnd.oracle.adf.resourceitem+json'
      )
    } else expect(request.body).toBeUndefined()
    expect(response.success).toBe(true)
    expect(JSON.stringify(response)).not.toContain('private-canary')
    if (entry.kind === 'delete') expect(response.output).toEqual({ deleted: true })
    if (entry.kind === 'action') {
      expect(response.output).toEqual({ result: entry.result === 'number' ? 12.5 : 'Successful' })
      expect(mocks.json).toHaveBeenCalledTimes(1)
    }
  })

  it.each([
    ['list_charges', 'charges', {}],
    ['list_charge_adjustments', 'charges/CH-001/child/adjustments', { chargePuid: 'CH-001' }],
    ['list_bill_lines', 'billLines', {}],
    ['list_bill_adjustments', 'billLines/B-001/child/billAdjustments', { billLinePuid: 'B-001' }],
  ] as const)('routes %s through both CRM billing scopes', async (name, resource, extra) => {
    mocks.json.mockResolvedValue({ items: [], count: 0, limit: 50, offset: 0, hasMore: false })
    for (const scope of ['product', 'covered_level']) {
      await executeOracleFusionSubscriptionOperation(name, {
        ...AUTH,
        ...PRODUCT,
        ...extra,
        billingScope: scope,
        ...(scope === 'covered_level' ? { coveredLevelPuid: 'C-001' } : {}),
      })
      const request = mocks.json.mock.calls.at(-1)![1]
      expect(request.address).toEqual({
        family: 'crm',
        relativePath:
          PRODUCT_PATH +
          (scope === 'covered_level' ? '/child/coveredLevels/C-001' : '') +
          '/child/' +
          resource,
      })
    }
  })

  it('binds unsafe-size numeric parent IDs from verified GETs before a covered charge create', async () => {
    const coveragePath = `${PRODUCT_PATH}/child/coveredLevels/C-001`
    mocks.json.mockImplementation(async (_credential, request: OracleFusionRequest) =>
      record(
        request.method === 'POST'
          ? `${coveragePath}/child/charges/CH-001`
          : request.address.relativePath,
        { SubscriptionId: '9007199254740993', SubscriptionProductId: '9007199254740995' }
      )
    )
    await executeOracleFusionSubscriptionOperation('create_charge', {
      ...AUTH,
      ...PRODUCT,
      billingScope: 'covered_level',
      coveredLevelPuid: 'C-001',
      priceType: 'RECURRING',
      invoicingRuleId: '-2',
      unitListPrice: 0,
    })
    expect(mocks.json.mock.calls.map((call) => call[1].address.relativePath)).toEqual([
      PRODUCT_PATH,
      coveragePath,
      `${coveragePath}/child/charges`,
    ])
    const body = serializeOracleFusionJsonBody(mocks.json.mock.calls[2][1].body)
    expect(body).toContain('"SubscriptionId":9007199254740993')
    expect(body).toContain('"SubscriptionProductId":9007199254740995')
    expect(body).toContain('"CoveredLevelId":678')
    expect(body).toContain('"InvoicingRuleId":-2')
    expect(body).toContain('"UnitListPrice":0')
  })

  it('stops a create when the covered-level numeric parents disagree', async () => {
    mocks.json.mockImplementation(async (_credential, request: OracleFusionRequest) =>
      record(request.address.relativePath, {
        SubscriptionProductId: request.address.relativePath === PRODUCT_PATH ? '456' : '999',
      })
    )
    await expect(
      executeOracleFusionSubscriptionOperation('create_charge', {
        ...AUTH,
        ...PRODUCT,
        billingScope: 'covered_level',
        coveredLevelPuid: 'C-001',
        priceType: 'RECURRING',
      })
    ).rejects.toThrow('another product')
    expect(mocks.json.mock.calls.every((call) => !call[1].method)).toBe(true)
  })

  it('preserves exact body identifiers, nullable PATCH fields, and decimal output strings', async () => {
    const amount = '123456789012345.123456789'
    mocks.json.mockResolvedValue(record(PRODUCT_PATH, { UnitPrice: amount }))
    const response = await executeOracleFusionSubscriptionOperation('update_product', {
      ...AUTH,
      ...PRODUCT,
      inventoryItemId: '9007199254740993',
      description: null,
      quantity: 0,
    })
    const body = serializeOracleFusionJsonBody(mocks.json.mock.calls[0][1].body)
    expect(body).toContain('"InventoryItemId":9007199254740993')
    expect(body).toContain('"Description":null')
    expect(body).toContain('"Quantity":0')
    expect(body).not.toContain('StartDate')
    expect(response.output.record?.UnitPrice).toBe(amount)
  })

  it('keeps opaque LOV keys separate from their numeric business IDs', async () => {
    mocks.json.mockResolvedValue(
      record('subscriptionItems/opaque-hash', { InventoryItemId: '9007199254740993' })
    )
    const response = await executeOracleFusionSubscriptionOperation('get_subscription_item', {
      ...AUTH,
      subscriptionItemKey: 'opaque-hash',
    })
    expect(response.output.record).toMatchObject({
      resourceKey: 'opaque-hash',
      InventoryItemId: '9007199254740993',
    })
    expect(mocks.json.mock.calls[0][1].address.relativePath).toBe('subscriptionItems/opaque-hash')
  })

  it('addresses reserved public-key characters using framework-9 double encoding', async () => {
    const subscriptionNumber = 'SUB:42 /%?#&'
    const path = 'subscriptions/SUB%253A42%2520%252F%2525%253F%2523%2526'
    mocks.json.mockResolvedValue(record(path, { SubscriptionNumber: subscriptionNumber }))
    const response = await executeOracleFusionSubscriptionOperation('get_subscription', {
      ...AUTH,
      subscriptionNumber,
    })
    expect(mocks.json.mock.calls[0][1].address.relativePath).toBe(path)
    expect(response.output.record?.SubscriptionNumber).toBe(subscriptionNumber)
  })

  it('rejects wrong origin, family, version, parent, selected key, and body identity', async () => {
    for (const href of [
      ROOT.replace('vision.', 'other.') + PRODUCT_PATH,
      ROOT.replace('crmRestApi', 'fscmRestApi') + PRODUCT_PATH,
      ROOT.replace('11.13.18.05', 'latest') + PRODUCT_PATH,
      ROOT + PRODUCT_PATH.replace('SUB-001', 'SUB-999'),
      ROOT + PRODUCT_PATH.replace('P-001', 'P-999'),
    ]) {
      mocks.json.mockResolvedValue(
        record(PRODUCT_PATH, { '@context': { links: [{ rel: 'self', href }] } })
      )
      await expect(
        executeOracleFusionSubscriptionOperation('get_product', { ...AUTH, ...PRODUCT })
      ).rejects.toThrow()
    }
    mocks.json.mockResolvedValue(record(PRODUCT_PATH, { SubscriptionNumber: 'SUB-999' }))
    await expect(
      executeOracleFusionSubscriptionOperation('get_product', { ...AUTH, ...PRODUCT })
    ).rejects.toThrow('another subscription')
  })

  it('returns bounded pages, estimated totals and actual-count continuation with the caller signal', async () => {
    const signal = new AbortController().signal
    mocks.json.mockResolvedValue({
      items: [record('subscriptions/SUB-001')],
      count: 1,
      limit: 25,
      offset: 25,
      hasMore: true,
      totalResults: 2,
    })
    const result = await listOracleFusionSubscriptionRecords(
      'subscription',
      { ...AUTH, limit: 25, offset: 25, totalResults: true, q: "Status='ACTIVE'" },
      signal
    )
    expect(result).toMatchObject({ count: 1, offset: 25, nextOffset: 26, totalResults: 2 })
    expect(mocks.json).toHaveBeenCalledTimes(1)
    expect(mocks.json.mock.calls[0][2]).toBe(signal)
    expect(mocks.json.mock.calls[0][1].query).toMatchObject({
      q: "Status='ACTIVE'",
      limit: 25,
      offset: 25,
      totalResults: true,
      links: 'self',
    })
    for (const page of [
      { items: [], count: 0, limit: 50, offset: 0, hasMore: true },
      { items: [], count: 1, limit: 50, offset: 0, hasMore: false },
      { items: [], count: 0, limit: 50, offset: 10, hasMore: false },
    ]) {
      mocks.json.mockResolvedValue(page)
      await expect(listOracleFusionSubscriptionRecords('subscription', AUTH)).rejects.toThrow()
    }
  })

  it('preserves documented calculation scalar types and does not classify renewal numbers as failures', async () => {
    for (const result of [123.45, '123456789012345.123456789']) {
      mocks.json.mockResolvedValue({ result })
      expect(
        (
          await executeOracleFusionSubscriptionOperation('calculate_product_termination_fee', {
            ...AUTH,
            ...PRODUCT,
          })
        ).output
      ).toEqual({ result })
    }
    mocks.json.mockResolvedValue({ result: 'FAILED' })
    expect(
      (
        await executeOracleFusionSubscriptionOperation('renew_subscription', {
          ...AUTH,
          subscriptionNumber: 'SUB-001',
        })
      ).output
    ).toEqual({ result: 'FAILED' })
    for (const result of [true, {}, 'NaN', '1.0\n']) {
      mocks.json.mockResolvedValue({ result })
      await expect(
        executeOracleFusionSubscriptionOperation('calculate_product_termination_fee', {
          ...AUTH,
          ...PRODUCT,
        })
      ).rejects.toThrow()
    }
  })
})
