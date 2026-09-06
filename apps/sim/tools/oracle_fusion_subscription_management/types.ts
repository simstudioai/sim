import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Documented CRM 11.13.18.05 fields: op-subscriptions-subscriptionnumber-get.html */
export const SUBSCRIPTION_OUTPUT_PROPERTIES = {
  SubscriptionId: {
    type: 'string',
    description: 'SubscriptionId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionNumber: {
    type: 'string',
    description: 'SubscriptionNumber',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  ShortDescription: {
    type: 'string',
    description: 'ShortDescription',
    optional: true,
    nullable: true,
  },
  PrimaryPartyId: {
    type: 'string',
    description: 'PrimaryPartyId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  PrimaryPartyName: {
    type: 'string',
    description: 'PrimaryPartyName',
    optional: true,
    nullable: true,
  },
  PrimaryPartyNumber: {
    type: 'string',
    description: 'PrimaryPartyNumber',
    optional: true,
    nullable: true,
  },
  BillToAccountId: {
    type: 'string',
    description: 'BillToAccountId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BillToAccountNumber: {
    type: 'string',
    description: 'BillToAccountNumber',
    optional: true,
    nullable: true,
  },
  BillToSiteUseId: {
    type: 'string',
    description: 'BillToSiteUseId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BillToContactId: {
    type: 'string',
    description: 'BillToContactId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BusinessUnitId: {
    type: 'string',
    description: 'BusinessUnitId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BusinessUnitName: {
    type: 'string',
    description: 'BusinessUnitName',
    optional: true,
    nullable: true,
  },
  LegalEntityId: {
    type: 'string',
    description: 'LegalEntityId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProfileId: {
    type: 'string',
    description: 'SubscriptionProfileId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProfileName: {
    type: 'string',
    description: 'SubscriptionProfileName',
    optional: true,
    nullable: true,
  },
  DefinitionOrganizationId: {
    type: 'string',
    description: 'DefinitionOrganizationId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AccountingRuleId: {
    type: 'string',
    description: 'AccountingRuleId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  InvoicingRuleId: {
    type: 'string',
    description: 'InvoicingRuleId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  TransactionTypeName: {
    type: 'string',
    description: 'TransactionTypeName',
    optional: true,
    nullable: true,
  },
  Currency: {
    type: 'string',
    description: 'Currency',
    optional: true,
    nullable: true,
  },
  StartDate: {
    type: 'string',
    description: 'StartDate',
    optional: true,
    nullable: true,
  },
  EndDate: {
    type: 'string',
    description: 'EndDate',
    optional: true,
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    optional: true,
    nullable: true,
  },
  StatusName: {
    type: 'string',
    description: 'StatusName',
    optional: true,
    nullable: true,
  },
  UserStatus: {
    type: 'string',
    description: 'UserStatus',
    optional: true,
    nullable: true,
  },
  BillingFrequency: {
    type: 'string',
    description: 'BillingFrequency',
    optional: true,
    nullable: true,
  },
  PaymentTermsId: {
    type: 'string',
    description: 'PaymentTermsId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  PaymentMethod: {
    type: 'string',
    description: 'PaymentMethod',
    optional: true,
    nullable: true,
  },
  TotalContractValue: {
    type: 'json',
    description: 'TotalContractValue as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  InvoicedAmount: {
    type: 'json',
    description: 'InvoicedAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  CreditedAmount: {
    type: 'json',
    description: 'CreditedAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  RenewalType: {
    type: 'string',
    description: 'RenewalType',
    optional: true,
    nullable: true,
  },
  RenewalProcess: {
    type: 'string',
    description: 'RenewalProcess',
    optional: true,
    nullable: true,
  },
  RenewalDuration: {
    type: 'number',
    description: 'RenewalDuration',
    optional: true,
    nullable: true,
  },
  RenewalDurationPeriod: {
    type: 'string',
    description: 'RenewalDurationPeriod',
    optional: true,
    nullable: true,
  },
  AsyncFlag: {
    type: 'boolean',
    description: 'AsyncFlag',
    optional: true,
    nullable: true,
  },
  LockedFlagReadOnly: {
    type: 'string',
    description: 'LockedFlagReadOnly',
    optional: true,
    nullable: true,
  },
  ValidationStatus: {
    type: 'string',
    description: 'ValidationStatus',
    optional: true,
    nullable: true,
  },
  SystemAction: {
    type: 'string',
    description: 'SystemAction',
    optional: true,
    nullable: true,
  },
  SystemActionStatus: {
    type: 'string',
    description: 'SystemActionStatus',
    optional: true,
    nullable: true,
  },
  SystemActionRequestId: {
    type: 'string',
    description: 'SystemActionRequestId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SystemActionDate: {
    type: 'string',
    description: 'SystemActionDate',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptions-subscriptionnumber-child-products-subscriptionproductpuid-get.html */
export const PRODUCT_OUTPUT_PROPERTIES = {
  SubscriptionId: {
    type: 'string',
    description: 'SubscriptionId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionNumber: {
    type: 'string',
    description: 'SubscriptionNumber',
    optional: true,
    nullable: true,
  },
  SubscriptionProductId: {
    type: 'string',
    description: 'SubscriptionProductId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProductPuid: {
    type: 'string',
    description: 'SubscriptionProductPuid',
    optional: true,
    nullable: true,
  },
  LineNumber: {
    type: 'string',
    description: 'LineNumber',
    optional: true,
    nullable: true,
  },
  InventoryItemId: {
    type: 'string',
    description: 'InventoryItemId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ProductName: {
    type: 'string',
    description: 'ProductName',
    optional: true,
    nullable: true,
  },
  SalesProductType: {
    type: 'string',
    description: 'SalesProductType',
    optional: true,
    nullable: true,
  },
  DefinitionOrganizationId: {
    type: 'string',
    description: 'DefinitionOrganizationId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AccountingRuleId: {
    type: 'string',
    description: 'AccountingRuleId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  InvoicingRuleId: {
    type: 'string',
    description: 'InvoicingRuleId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BillToAccountId: {
    type: 'string',
    description: 'BillToAccountId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BillToSiteUseId: {
    type: 'string',
    description: 'BillToSiteUseId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BillingFrequency: {
    type: 'string',
    description: 'BillingFrequency',
    optional: true,
    nullable: true,
  },
  Currency: {
    type: 'string',
    description: 'Currency',
    optional: true,
    nullable: true,
  },
  TransactionTypeName: {
    type: 'string',
    description: 'TransactionTypeName',
    optional: true,
    nullable: true,
  },
  StartDate: {
    type: 'string',
    description: 'StartDate',
    optional: true,
    nullable: true,
  },
  EndDate: {
    type: 'string',
    description: 'EndDate',
    optional: true,
    nullable: true,
  },
  Quantity: {
    type: 'json',
    description: 'Quantity as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  UnitPrice: {
    type: 'json',
    description: 'UnitPrice as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  PaymentTermsId: {
    type: 'string',
    description: 'PaymentTermsId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  PaymentMethod: {
    type: 'string',
    description: 'PaymentMethod',
    optional: true,
    nullable: true,
  },
  ItemUnitOfMeasure: {
    type: 'string',
    description: 'ItemUnitOfMeasure',
    optional: true,
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    optional: true,
    nullable: true,
  },
  StatusMeaning: {
    type: 'string',
    description: 'StatusMeaning',
    optional: true,
    nullable: true,
  },
  TotalContractValue: {
    type: 'json',
    description: 'TotalContractValue as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  InvoicedAmount: {
    type: 'json',
    description: 'InvoicedAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  CreditedAmount: {
    type: 'json',
    description: 'CreditedAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  MonthlyRecurringRevenue: {
    type: 'json',
    description: 'MonthlyRecurringRevenue as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  ExternalAssetKey: {
    type: 'string',
    description: 'ExternalAssetKey',
    optional: true,
    nullable: true,
  },
  AmendSourceProductPuid: {
    type: 'string',
    description: 'AmendSourceProductPuid',
    optional: true,
    nullable: true,
  },
  OriginalSubscriptionProductPuid: {
    type: 'string',
    description: 'OriginalSubscriptionProductPuid',
    optional: true,
    nullable: true,
  },
  AsyncFlag: {
    type: 'boolean',
    description: 'AsyncFlag',
    optional: true,
    nullable: true,
  },
  PendingActivationFlag: {
    type: 'boolean',
    description: 'PendingActivationFlag',
    optional: true,
    nullable: true,
  },
  ValidationStatus: {
    type: 'string',
    description: 'ValidationStatus',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptions-subscriptionnumber-child-products-subscriptionproductpuid-child-coveredlevels-coveredlevelpuid-get.html */
export const COVERED_LEVEL_OUTPUT_PROPERTIES = {
  CoveredLevelId: {
    type: 'string',
    description: 'CoveredLevelId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  CoveredLevelPuid: {
    type: 'string',
    description: 'CoveredLevelPuid',
    optional: true,
    nullable: true,
  },
  CoveredLevelParentPuid: {
    type: 'string',
    description: 'CoveredLevelParentPuid',
    optional: true,
    nullable: true,
  },
  ParentCoveredLevelId: {
    type: 'string',
    description: 'ParentCoveredLevelId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionId: {
    type: 'string',
    description: 'SubscriptionId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProductId: {
    type: 'string',
    description: 'SubscriptionProductId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  Type: {
    type: 'string',
    description: 'Type',
    optional: true,
    nullable: true,
  },
  TypeName: {
    type: 'string',
    description: 'TypeName',
    optional: true,
    nullable: true,
  },
  CoveredLevelName: {
    type: 'string',
    description: 'CoveredLevelName',
    optional: true,
    nullable: true,
  },
  AssetId: {
    type: 'string',
    description: 'AssetId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AssetName: {
    type: 'string',
    description: 'AssetName',
    optional: true,
    nullable: true,
  },
  AssetSerialNumber: {
    type: 'string',
    description: 'AssetSerialNumber',
    optional: true,
    nullable: true,
  },
  PartyId: {
    type: 'string',
    description: 'PartyId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  CustomerAccountId: {
    type: 'string',
    description: 'CustomerAccountId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ProductGroupId: {
    type: 'string',
    description: 'ProductGroupId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  InventoryItemId: {
    type: 'string',
    description: 'InventoryItemId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  Quantity: {
    type: 'json',
    description: 'Quantity as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  UnitPrice: {
    type: 'json',
    description: 'UnitPrice as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  ItemUnitOfMeasure: {
    type: 'string',
    description: 'ItemUnitOfMeasure',
    optional: true,
    nullable: true,
  },
  StartDate: {
    type: 'string',
    description: 'StartDate',
    optional: true,
    nullable: true,
  },
  EndDate: {
    type: 'string',
    description: 'EndDate',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    optional: true,
    nullable: true,
  },
  TotalContractValue: {
    type: 'json',
    description: 'TotalContractValue as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  InvoicedAmount: {
    type: 'json',
    description: 'InvoicedAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  CreditedAmount: {
    type: 'json',
    description: 'CreditedAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptions-subscriptionnumber-child-products-subscriptionproductpuid-child-associatedasset-get.html */
export const ASSOCIATED_ASSET_OUTPUT_PROPERTIES = {
  AssociatedAssetId: {
    type: 'string',
    description: 'AssociatedAssetId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AssociatedAssetPuid: {
    type: 'string',
    description: 'AssociatedAssetPuid',
    optional: true,
    nullable: true,
  },
  SubscriptionId: {
    type: 'string',
    description: 'SubscriptionId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProductId: {
    type: 'string',
    description: 'SubscriptionProductId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AssetId: {
    type: 'string',
    description: 'AssetId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AssetName: {
    type: 'string',
    description: 'AssetName',
    optional: true,
    nullable: true,
  },
  AssetDescription: {
    type: 'string',
    description: 'AssetDescription',
    optional: true,
    nullable: true,
  },
  AssetSerialNumber: {
    type: 'string',
    description: 'AssetSerialNumber',
    optional: true,
    nullable: true,
  },
  InventoryItemId: {
    type: 'string',
    description: 'InventoryItemId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ProductName: {
    type: 'string',
    description: 'ProductName',
    optional: true,
    nullable: true,
  },
  Quantity: {
    type: 'json',
    description: 'Quantity as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  UnitOfMeasureCode: {
    type: 'string',
    description: 'UnitOfMeasureCode',
    optional: true,
    nullable: true,
  },
  SourceSystem: {
    type: 'string',
    description: 'SourceSystem',
    optional: true,
    nullable: true,
  },
  SourceKey: {
    type: 'string',
    description: 'SourceKey',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptions-subscriptionnumber-child-products-subscriptionproductpuid-child-charges-chargepuid-get.html */
export const CHARGE_OUTPUT_PROPERTIES = {
  ChargeId: {
    type: 'string',
    description: 'ChargeId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ChargePuid: {
    type: 'string',
    description: 'ChargePuid',
    optional: true,
    nullable: true,
  },
  SubscriptionId: {
    type: 'string',
    description: 'SubscriptionId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProductId: {
    type: 'string',
    description: 'SubscriptionProductId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  CoveredLevelId: {
    type: 'string',
    description: 'CoveredLevelId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ChargeName: {
    type: 'string',
    description: 'ChargeName',
    optional: true,
    nullable: true,
  },
  ChargeDefinition: {
    type: 'string',
    description: 'ChargeDefinition',
    optional: true,
    nullable: true,
  },
  ChargeDefinitionName: {
    type: 'string',
    description: 'ChargeDefinitionName',
    optional: true,
    nullable: true,
  },
  PriceType: {
    type: 'string',
    description: 'PriceType',
    optional: true,
    nullable: true,
  },
  UnitListPrice: {
    type: 'json',
    description: 'UnitListPrice as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  PricePeriodicity: {
    type: 'string',
    description: 'PricePeriodicity',
    optional: true,
    nullable: true,
  },
  BillingFreq: {
    type: 'string',
    description: 'BillingFreq',
    optional: true,
    nullable: true,
  },
  InvoicingRuleId: {
    type: 'string',
    description: 'InvoicingRuleId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  UsageUnitOfMeasure: {
    type: 'string',
    description: 'UsageUnitOfMeasure',
    optional: true,
    nullable: true,
  },
  MinimumAmount: {
    type: 'json',
    description: 'MinimumAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  MinimumQuantity: {
    type: 'json',
    description: 'MinimumQuantity as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  AllowAdhocBillAdjustmentFlag: {
    type: 'boolean',
    description: 'AllowAdhocBillAdjustmentFlag',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptions-subscriptionnumber-child-products-subscriptionproductpuid-child-charges-chargepuid-child-adjustments-chargeadjustmentpuid-get.html */
export const CHARGE_ADJUSTMENT_OUTPUT_PROPERTIES = {
  ChargeAdjustmentId: {
    type: 'string',
    description: 'ChargeAdjustmentId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ChargeAdjustmentPuid: {
    type: 'string',
    description: 'ChargeAdjustmentPuid',
    optional: true,
    nullable: true,
  },
  ChargeId: {
    type: 'string',
    description: 'ChargeId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionId: {
    type: 'string',
    description: 'SubscriptionId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProductId: {
    type: 'string',
    description: 'SubscriptionProductId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AdjustmentName: {
    type: 'string',
    description: 'AdjustmentName',
    optional: true,
    nullable: true,
  },
  AdjustmentType: {
    type: 'string',
    description: 'AdjustmentType',
    optional: true,
    nullable: true,
  },
  AdjustmentValue: {
    type: 'json',
    description: 'AdjustmentValue as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  AdjustmentBasis: {
    type: 'string',
    description: 'AdjustmentBasis',
    optional: true,
    nullable: true,
  },
  AdjustmentReasonCode: {
    type: 'string',
    description: 'AdjustmentReasonCode',
    optional: true,
    nullable: true,
  },
  AdjustmentReasonMeaning: {
    type: 'string',
    description: 'AdjustmentReasonMeaning',
    optional: true,
    nullable: true,
  },
  Effectivity: {
    type: 'string',
    description: 'Effectivity',
    optional: true,
    nullable: true,
  },
  PeriodFrom: {
    type: 'json',
    description: 'PeriodFrom as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  PeriodUntil: {
    type: 'json',
    description: 'PeriodUntil as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  NumberOfPeriods: {
    type: 'json',
    description: 'NumberOfPeriods as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  ValidFrom: {
    type: 'string',
    description: 'ValidFrom',
    optional: true,
    nullable: true,
  },
  ValidUntil: {
    type: 'string',
    description: 'ValidUntil',
    optional: true,
    nullable: true,
  },
  RevenueOptionChargeAdjustment: {
    type: 'string',
    description: 'RevenueOptionChargeAdjustment',
    optional: true,
    nullable: true,
  },
  RevenuePeriodChargeAdjustment: {
    type: 'string',
    description: 'RevenuePeriodChargeAdjustment',
    optional: true,
    nullable: true,
  },
  IsEditableFlag: {
    type: 'boolean',
    description: 'IsEditableFlag',
    optional: true,
    nullable: true,
  },
  IsStatusNotDraft: {
    type: 'string',
    description: 'IsStatusNotDraft',
    optional: true,
    nullable: true,
  },
  IsUserCreated: {
    type: 'string',
    description: 'IsUserCreated',
    optional: true,
    nullable: true,
  },
  ObjectVersionNumber: {
    type: 'number',
    description: 'ObjectVersionNumber',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptions-subscriptionnumber-child-products-subscriptionproductpuid-child-billlines-billlinepuid-get.html */
export const BILL_LINE_OUTPUT_PROPERTIES = {
  BillLineId: {
    type: 'string',
    description: 'BillLineId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BillLinePuid: {
    type: 'string',
    description: 'BillLinePuid',
    optional: true,
    nullable: true,
  },
  SubscriptionId: {
    type: 'string',
    description: 'SubscriptionId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProductId: {
    type: 'string',
    description: 'SubscriptionProductId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  CoveredLevelId: {
    type: 'string',
    description: 'CoveredLevelId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ChargeId: {
    type: 'string',
    description: 'ChargeId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ChargePuid: {
    type: 'string',
    description: 'ChargePuid',
    optional: true,
    nullable: true,
  },
  ChargeName: {
    type: 'string',
    description: 'ChargeName',
    optional: true,
    nullable: true,
  },
  Amount: {
    type: 'json',
    description: 'Amount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  DateBilledFrom: {
    type: 'string',
    description: 'DateBilledFrom',
    optional: true,
    nullable: true,
  },
  DateBilledTo: {
    type: 'string',
    description: 'DateBilledTo',
    optional: true,
    nullable: true,
  },
  DateToInterface: {
    type: 'string',
    description: 'DateToInterface',
    optional: true,
    nullable: true,
  },
  InterfacedFlag: {
    type: 'boolean',
    description: 'InterfacedFlag',
    optional: true,
    nullable: true,
  },
  InvoiceDate: {
    type: 'string',
    description: 'InvoiceDate',
    optional: true,
    nullable: true,
  },
  InvoiceText: {
    type: 'string',
    description: 'InvoiceText',
    optional: true,
    nullable: true,
  },
  TransactionNumber: {
    type: 'string',
    description: 'TransactionNumber',
    optional: true,
    nullable: true,
  },
  TrxId: {
    type: 'string',
    description: 'TrxId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  TrxLineId: {
    type: 'string',
    description: 'TrxLineId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  TransactionAmount: {
    type: 'json',
    description: 'TransactionAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  TransactionTax: {
    type: 'json',
    description: 'TransactionTax as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  TransactionClass: {
    type: 'string',
    description: 'TransactionClass',
    optional: true,
    nullable: true,
  },
  CreditMemoAmount: {
    type: 'json',
    description: 'CreditMemoAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  CreditMemoFlag: {
    type: 'string',
    description: 'CreditMemoFlag',
    optional: true,
    nullable: true,
  },
  CreditMemoReasonCode: {
    type: 'string',
    description: 'CreditMemoReasonCode',
    optional: true,
    nullable: true,
  },
  UsageQuantity: {
    type: 'json',
    description: 'UsageQuantity as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  UsageFlag: {
    type: 'boolean',
    description: 'UsageFlag',
    optional: true,
    nullable: true,
  },
  UsageAcquiredFlag: {
    type: 'boolean',
    description: 'UsageAcquiredFlag',
    optional: true,
    nullable: true,
  },
  UsagePricedFlag: {
    type: 'boolean',
    description: 'UsagePricedFlag',
    optional: true,
    nullable: true,
  },
  UsageCaptureDate: {
    type: 'string',
    description: 'UsageCaptureDate',
    optional: true,
    nullable: true,
  },
  UsageRatingProcess: {
    type: 'string',
    description: 'UsageRatingProcess',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptionnumber-child-products-subscriptionproductpuid-child-billlines-billlinepuid-child-billadjustments-billadjustmentpuid-get.html */
export const BILL_ADJUSTMENT_OUTPUT_PROPERTIES = {
  BillAdjustmentId: {
    type: 'string',
    description: 'BillAdjustmentId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BillAdjustmentPuid: {
    type: 'string',
    description: 'BillAdjustmentPuid',
    optional: true,
    nullable: true,
  },
  BillLineId: {
    type: 'string',
    description: 'BillLineId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ChargeAdjustmentId: {
    type: 'string',
    description: 'ChargeAdjustmentId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ChargeAdjustmentPuid: {
    type: 'string',
    description: 'ChargeAdjustmentPuid',
    optional: true,
    nullable: true,
  },
  SubscriptionId: {
    type: 'string',
    description: 'SubscriptionId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProductId: {
    type: 'string',
    description: 'SubscriptionProductId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AdjustmentType: {
    type: 'string',
    description: 'AdjustmentType',
    optional: true,
    nullable: true,
  },
  AdjustmentValue: {
    type: 'json',
    description: 'AdjustmentValue as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  AdjustmentBasis: {
    type: 'string',
    description: 'AdjustmentBasis',
    optional: true,
    nullable: true,
  },
  AdjustmentReasonCode: {
    type: 'string',
    description: 'AdjustmentReasonCode',
    optional: true,
    nullable: true,
  },
  Effectivity: {
    type: 'string',
    description: 'Effectivity',
    optional: true,
    nullable: true,
  },
  PeriodFrom: {
    type: 'json',
    description: 'PeriodFrom as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  PeriodUntil: {
    type: 'json',
    description: 'PeriodUntil as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  NumberOfPeriods: {
    type: 'json',
    description: 'NumberOfPeriods as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  RevenueOption: {
    type: 'string',
    description: 'RevenueOption',
    optional: true,
    nullable: true,
  },
  RevenuePeriod: {
    type: 'string',
    description: 'RevenuePeriod',
    optional: true,
    nullable: true,
  },
  RevenueAdjustmentFromDate: {
    type: 'string',
    description: 'RevenueAdjustmentFromDate',
    optional: true,
    nullable: true,
  },
  RevenueAdjustmentToDate: {
    type: 'string',
    description: 'RevenueAdjustmentToDate',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptions-subscriptionnumber-child-validatesubscription-validatesubscriptionuniqid-get.html */
export const VALIDATION_RESULT_OUTPUT_PROPERTIES = {
  resourceKey: {
    type: 'string',
    description: 'Opaque key from the validated self link; use for detail requests',
  },
  ErrorSeverity: {
    type: 'string',
    description: 'ErrorSeverity',
    optional: true,
    nullable: true,
  },
  MessageText: {
    type: 'string',
    description: 'MessageText',
    optional: true,
    nullable: true,
  },
  ObjectId: {
    type: 'string',
    description: 'ObjectId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ObjectName: {
    type: 'string',
    description: 'ObjectName',
    optional: true,
    nullable: true,
  },
  ObjectType: {
    type: 'string',
    description: 'ObjectType',
    optional: true,
    nullable: true,
  },
  RelatedObjectId: {
    type: 'string',
    description: 'RelatedObjectId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  RelatedObjectName: {
    type: 'string',
    description: 'RelatedObjectName',
    optional: true,
    nullable: true,
  },
  SubscriptionNumber: {
    type: 'string',
    description: 'SubscriptionNumber',
    optional: true,
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'CreationDate',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptionprofiles-subscriptionprofileid-get.html */
export const SUBSCRIPTION_PROFILE_OUTPUT_PROPERTIES = {
  resourceKey: {
    type: 'string',
    description: 'Opaque key from the validated self link; use for detail requests',
  },
  SubscriptionProfileId: {
    type: 'string',
    description: 'SubscriptionProfileId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProfilePuid: {
    type: 'string',
    description: 'SubscriptionProfilePuid',
    optional: true,
    nullable: true,
  },
  SubscriptionProfileName: {
    type: 'string',
    description: 'SubscriptionProfileName',
    optional: true,
    nullable: true,
  },
  SubscriptionProfileDescription: {
    type: 'string',
    description: 'SubscriptionProfileDescription',
    optional: true,
    nullable: true,
  },
  AccountingRuleId: {
    type: 'string',
    description: 'AccountingRuleId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AccountingRuleName: {
    type: 'string',
    description: 'AccountingRuleName',
    optional: true,
    nullable: true,
  },
  InvoicingRuleId: {
    type: 'string',
    description: 'InvoicingRuleId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BillingFrequency: {
    type: 'string',
    description: 'BillingFrequency',
    optional: true,
    nullable: true,
  },
  PartialPeriodStart: {
    type: 'string',
    description: 'PartialPeriodStart',
    optional: true,
    nullable: true,
  },
  PartialPeriodType: {
    type: 'string',
    description: 'PartialPeriodType',
    optional: true,
    nullable: true,
  },
  PaymentTermsId: {
    type: 'string',
    description: 'PaymentTermsId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  PaymentTermsName: {
    type: 'string',
    description: 'PaymentTermsName',
    optional: true,
    nullable: true,
  },
  TransactionTypeName: {
    type: 'string',
    description: 'TransactionTypeName',
    optional: true,
    nullable: true,
  },
  BillGenerationMethodCode: {
    type: 'string',
    description: 'BillGenerationMethodCode',
    optional: true,
    nullable: true,
  },
  CloseCreditMethod: {
    type: 'string',
    description: 'CloseCreditMethod',
    optional: true,
    nullable: true,
  },
  CreditType: {
    type: 'string',
    description: 'CreditType',
    optional: true,
    nullable: true,
  },
  RevenueOptionAmend: {
    type: 'string',
    description: 'RevenueOptionAmend',
    optional: true,
    nullable: true,
  },
  RevenueOptionRenew: {
    type: 'string',
    description: 'RevenueOptionRenew',
    optional: true,
    nullable: true,
  },
  RevenueOptionClose: {
    type: 'string',
    description: 'RevenueOptionClose',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptionitems-subscriptionitemsuniqid-get.html */
export const SUBSCRIPTION_ITEM_OUTPUT_PROPERTIES = {
  resourceKey: {
    type: 'string',
    description: 'Opaque key from the validated self link; use for detail requests',
  },
  InventoryItemId: {
    type: 'string',
    description: 'InventoryItemId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ItemNumber: {
    type: 'string',
    description: 'ItemNumber',
    optional: true,
    nullable: true,
  },
  OrganizationId: {
    type: 'string',
    description: 'OrganizationId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  OrganizationCode: {
    type: 'string',
    description: 'OrganizationCode',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptionassets-get.html */
export const SUBSCRIPTION_ASSET_OUTPUT_PROPERTIES = {
  resourceKey: {
    type: 'string',
    description: 'Opaque key from the validated self link; use for detail requests',
  },
  AssetId: {
    type: 'string',
    description: 'AssetId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AssetNumber: {
    type: 'string',
    description: 'AssetNumber',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  SerialNumber: {
    type: 'string',
    description: 'SerialNumber',
    optional: true,
    nullable: true,
  },
  InventoryItemId: {
    type: 'string',
    description: 'InventoryItemId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ItemNumber: {
    type: 'string',
    description: 'ItemNumber',
    optional: true,
    nullable: true,
  },
  OrganizationId: {
    type: 'string',
    description: 'OrganizationId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  OrganizationCode: {
    type: 'string',
    description: 'OrganizationCode',
    optional: true,
    nullable: true,
  },
  CustomerId: {
    type: 'string',
    description: 'CustomerId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  PartyId: {
    type: 'string',
    description: 'PartyId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  PartyName: {
    type: 'string',
    description: 'PartyName',
    optional: true,
    nullable: true,
  },
  BuId: {
    type: 'string',
    description: 'BuId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  BuName: {
    type: 'string',
    description: 'BuName',
    optional: true,
    nullable: true,
  },
  ActiveEndDate: {
    type: 'string',
    description: 'ActiveEndDate',
    optional: true,
    nullable: true,
  },
  Quantity: {
    type: 'json',
    description: 'Quantity as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  UomCode: {
    type: 'string',
    description: 'UomCode',
    optional: true,
    nullable: true,
  },
  ServiceableProductFlag: {
    type: 'boolean',
    description: 'ServiceableProductFlag',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-organizationcodes-organizationid-get.html */
export const ORGANIZATION_OUTPUT_PROPERTIES = {
  resourceKey: {
    type: 'string',
    description: 'Opaque key from the validated self link; use for detail requests',
  },
  OrganizationId: {
    type: 'string',
    description: 'OrganizationId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  OrganizationCode: {
    type: 'string',
    description: 'OrganizationCode',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-billtoaccounts-custaccountid-get.html */
export const BILL_TO_ACCOUNT_OUTPUT_PROPERTIES = {
  resourceKey: {
    type: 'string',
    description: 'Opaque key from the validated self link; use for detail requests',
  },
  CustAccountId: {
    type: 'string',
    description: 'CustAccountId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AccountNumber: {
    type: 'string',
    description: 'AccountNumber',
    optional: true,
    nullable: true,
  },
  AccountName: {
    type: 'string',
    description: 'AccountName',
    optional: true,
    nullable: true,
  },
  PartyId: {
    type: 'string',
    description: 'PartyId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  PartyNumber: {
    type: 'string',
    description: 'PartyNumber',
    optional: true,
    nullable: true,
  },
  PartyName: {
    type: 'string',
    description: 'PartyName',
    optional: true,
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-billtosites-siteuseid-get.html */
export const BILL_TO_SITE_OUTPUT_PROPERTIES = {
  resourceKey: {
    type: 'string',
    description: 'Opaque key from the validated self link; use for detail requests',
  },
  SiteUseId: {
    type: 'string',
    description: 'SiteUseId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  CustAccountId: {
    type: 'string',
    description: 'CustAccountId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  PartySiteName: {
    type: 'string',
    description: 'PartySiteName',
    optional: true,
    nullable: true,
  },
  PartySiteNumber: {
    type: 'string',
    description: 'PartySiteNumber',
    optional: true,
    nullable: true,
  },
  Address: {
    type: 'string',
    description: 'Address',
    optional: true,
    nullable: true,
  },
  Location: {
    type: 'string',
    description: 'Location',
    optional: true,
    nullable: true,
  },
  SiteUseCode: {
    type: 'string',
    description: 'SiteUseCode',
    optional: true,
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    optional: true,
    nullable: true,
  },
  StartDate: {
    type: 'string',
    description: 'StartDate',
    optional: true,
    nullable: true,
  },
  EndDate: {
    type: 'string',
    description: 'EndDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Documented CRM 11.13.18.05 fields: op-subscriptionnumber-child-products-subscriptionproductpuid-child-coveredlevels-coveredlevelpuid-child-childcoveredlevels-coveredlevelpuid2-get.html */
export const CHILD_COVERED_LEVEL_OUTPUT_PROPERTIES = {
  CoveredLevelId: {
    type: 'string',
    description: 'CoveredLevelId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  CoveredLevelPuid: {
    type: 'string',
    description: 'CoveredLevelPuid',
    optional: true,
    nullable: true,
  },
  CoveredLevelParentPuid: {
    type: 'string',
    description: 'CoveredLevelParentPuid',
    optional: true,
    nullable: true,
  },
  ParentCoveredLevelId: {
    type: 'string',
    description: 'ParentCoveredLevelId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionId: {
    type: 'string',
    description: 'SubscriptionId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  SubscriptionProductId: {
    type: 'string',
    description: 'SubscriptionProductId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  Type: {
    type: 'string',
    description: 'Type',
    optional: true,
    nullable: true,
  },
  TypeName: {
    type: 'string',
    description: 'TypeName',
    optional: true,
    nullable: true,
  },
  CoveredLevelName: {
    type: 'string',
    description: 'CoveredLevelName',
    optional: true,
    nullable: true,
  },
  AssetId: {
    type: 'string',
    description: 'AssetId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  AssetName: {
    type: 'string',
    description: 'AssetName',
    optional: true,
    nullable: true,
  },
  AssetSerialNumber: {
    type: 'string',
    description: 'AssetSerialNumber',
    optional: true,
    nullable: true,
  },
  PartyId: {
    type: 'string',
    description: 'PartyId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  CustomerAccountId: {
    type: 'string',
    description: 'CustomerAccountId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  ProductGroupId: {
    type: 'string',
    description: 'ProductGroupId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  InventoryItemId: {
    type: 'string',
    description: 'InventoryItemId as an exact decimal string',
    optional: true,
    nullable: true,
  },
  Quantity: {
    type: 'json',
    description: 'Quantity as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  UnitPrice: {
    type: 'json',
    description: 'UnitPrice as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  ItemUnitOfMeasure: {
    type: 'string',
    description: 'ItemUnitOfMeasure',
    optional: true,
    nullable: true,
  },
  StartDate: {
    type: 'string',
    description: 'StartDate',
    optional: true,
    nullable: true,
  },
  EndDate: {
    type: 'string',
    description: 'EndDate',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  Status: {
    type: 'string',
    description: 'Status',
    optional: true,
    nullable: true,
  },
  TotalContractValue: {
    type: 'json',
    description: 'TotalContractValue as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  InvoicedAmount: {
    type: 'json',
    description: 'InvoicedAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  CreditedAmount: {
    type: 'json',
    description: 'CreditedAmount as a number or exact decimal string',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'LastUpdateDate',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const PAGINATION_OUTPUTS = {
  count: { type: 'number', description: 'Number of records in this page' },
  hasMore: { type: 'boolean', description: 'Whether Oracle reports another page' },
  limit: { type: 'number', description: 'Page size returned by Oracle' },
  offset: { type: 'number', description: 'Offset returned by Oracle' },
  totalResults: {
    type: 'number',
    description: 'Estimated matching total when Oracle provides it',
    optional: true,
  },
  nextOffset: {
    type: 'number',
    description: 'Next request offset, present only when hasMore is true',
    optional: true,
  },
} satisfies Record<string, OutputProperty>

export interface OracleFusionSubscriptionAuthParams {
  oauthCredential: string
  accessToken: string
  instanceUrl: string
}

export interface OracleFusionSubscriptionPageParams {
  q?: string
  finder?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export type OracleFusionSubscriptionRecord = Record<string, string | number | boolean | null>

export interface OracleFusionSubscriptionResponse extends ToolResponse {
  output: {
    record?: OracleFusionSubscriptionRecord
    items?: OracleFusionSubscriptionRecord[]
    result?: string | number
    deleted?: boolean
    count?: number
    hasMore?: boolean
    limit?: number
    offset?: number
    totalResults?: number
    nextOffset?: number
  }
}

export interface OracleFusionSubscriptionListSubscriptionsParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {}

export interface OracleFusionSubscriptionGetSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
}

export interface OracleFusionSubscriptionCreateSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  newSubscriptionNumber: string
  description?: string | null
  shortDescription?: string | null
  primaryPartyId: string
  billToAccountId: string
  billToSiteUseId: string
  billToContactId?: string | null
  businessUnitId: string
  legalEntityId: string
  subscriptionProfileId: string
  definitionOrganizationId: string
  accountingRuleId: string
  invoicingRuleId?: string | null
  transactionTypeName: string
  currency: string
  startDate?: string
  endDate?: string | null
  duration?: number | null
  period?: string | null
  partialPeriodStart: string
  partialPeriodType: string
  billingFrequency?: string | null
  paymentTermsId?: string | null
  paymentMethod?: string | null
  pONumber?: string | null
  renewalType?: string | null
  renewalProcess?: string | null
  renewalDuration?: number | null
  renewalDurationPeriod?: string | null
  sourceSystem?: string | null
  sourceKey?: string | null
  sourceNumber?: string | null
  subscriptionInvoiceText?: string | null
}

export interface OracleFusionSubscriptionUpdateSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  description?: string | null
  shortDescription?: string | null
  billToAccountId?: string
  billToSiteUseId?: string
  billToContactId?: string | null
  accountingRuleId?: string
  invoicingRuleId?: string | null
  transactionTypeName?: string
  currency?: string
  startDate?: string
  endDate?: string | null
  duration?: number | null
  period?: string | null
  billingFrequency?: string | null
  paymentTermsId?: string | null
  paymentMethod?: string | null
  pONumber?: string | null
  renewalType?: string | null
  renewalProcess?: string | null
  renewalDuration?: number | null
  renewalDurationPeriod?: string | null
  sourceSystem?: string | null
  sourceKey?: string | null
  sourceNumber?: string | null
  subscriptionInvoiceText?: string | null
}

export interface OracleFusionSubscriptionDeleteSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
}

export interface OracleFusionSubscriptionListProductsParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {
  subscriptionNumber: string
}

export interface OracleFusionSubscriptionGetProductParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
}

export interface OracleFusionSubscriptionCreateProductParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  newSubscriptionProductPuid: string
  lineNumber: string
  inventoryItemId: string
  definitionOrganizationId: string
  accountingRuleId: string
  invoicingRuleId: string
  billToAccountId: string
  billToSiteUseId: string
  billToContactId?: string | null
  billingFrequency: string
  currency: string
  transactionTypeName: string
  startDate: string
  endDate?: string | null
  quantity?: number | null
  unitPrice?: number | null
  description?: string | null
  paymentTermsId?: string | null
  paymentMethod?: string | null
  pONumber?: string | null
  itemUnitOfMeasure?: string | null
  invoiceText?: string | null
  externalAssetKey?: string | null
  sourceSystem?: string | null
  sourceKey?: string | null
  sourceLineKey?: string | null
  sourceLineNumber?: string | null
  renewalType?: string | null
}

export interface OracleFusionSubscriptionUpdateProductParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  inventoryItemId?: string
  accountingRuleId?: string
  invoicingRuleId?: string
  billToAccountId?: string
  billToSiteUseId?: string
  billToContactId?: string | null
  billingFrequency?: string
  transactionTypeName?: string
  startDate?: string
  endDate?: string | null
  quantity?: number | null
  unitPrice?: number | null
  description?: string | null
  paymentTermsId?: string | null
  paymentMethod?: string | null
  pONumber?: string | null
  itemUnitOfMeasure?: string | null
  invoiceText?: string | null
  externalAssetKey?: string | null
  sourceSystem?: string | null
  sourceKey?: string | null
  sourceLineKey?: string | null
  sourceLineNumber?: string | null
  renewalType?: string | null
}

export interface OracleFusionSubscriptionDeleteProductParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
}

export interface OracleFusionSubscriptionListCoveredLevelsParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
}

export interface OracleFusionSubscriptionGetCoveredLevelParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  coveredLevelPuid: string
}

export interface OracleFusionSubscriptionCreateCoveredLevelParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  newCoveredLevelPuid: string
  type: string
  startDate: string
  endDate?: string | null
  description?: string | null
  assetId?: string | null
  partyId?: string | null
  customerAccountId?: string | null
  productGroupId?: string | null
  inventoryItemId?: string | null
  quantity?: number
  unitPrice?: number | null
  itemUnitOfMeasure?: string | null
  invoiceText?: string | null
  sourceSystem?: string | null
  sourceKey?: string | null
  sourceLineKey?: string | null
  sourceLineNumber?: string | null
}

export interface OracleFusionSubscriptionUpdateCoveredLevelParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  coveredLevelPuid: string
  startDate?: string
  endDate?: string | null
  description?: string | null
  assetId?: string | null
  partyId?: string | null
  customerAccountId?: string | null
  productGroupId?: string | null
  inventoryItemId?: string | null
  quantity?: number
  unitPrice?: number | null
  itemUnitOfMeasure?: string | null
  invoiceText?: string | null
  sourceSystem?: string | null
  sourceKey?: string | null
  sourceLineKey?: string | null
  sourceLineNumber?: string | null
}

export interface OracleFusionSubscriptionDeleteCoveredLevelParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  coveredLevelPuid: string
}

export interface OracleFusionSubscriptionListAssociatedAssetsParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
}

export interface OracleFusionSubscriptionGetAssociatedAssetParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  associatedAssetPuid: string
}

export interface OracleFusionSubscriptionCreateAssociatedAssetParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  associatedAssetPuid?: string
  assetId?: string | null
  assetName?: string | null
  assetSerialNumber?: string | null
  inventoryItemId?: string | null
  productName?: string | null
  quantity?: number | null
  unitOfMeasureCode?: string | null
  sourceSystem?: string | null
  sourceKey?: string | null
  sourceLineKey?: string | null
  sourceLineNumber?: string | null
}

export interface OracleFusionSubscriptionUpdateAssociatedAssetParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  associatedAssetPuid: string
  assetName?: string | null
  assetSerialNumber?: string | null
  inventoryItemId?: string | null
  productName?: string | null
  quantity?: number | null
  unitOfMeasureCode?: string | null
  sourceSystem?: string | null
  sourceKey?: string | null
  sourceLineKey?: string | null
  sourceLineNumber?: string | null
}

export interface OracleFusionSubscriptionDeleteAssociatedAssetParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  associatedAssetPuid: string
}

export interface OracleFusionSubscriptionListChargesParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
}

export interface OracleFusionSubscriptionGetChargeParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  chargePuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
}

export interface OracleFusionSubscriptionCreateChargeParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
  chargePuid?: string | null
  chargeName?: string | null
  chargeDefinition?: string | null
  priceType: string
  unitListPrice?: number | null
  pricePeriodicity?: string | null
  billingFreq?: string | null
  invoicingRuleId?: string | null
  sequenceNumber?: number | null
  usageUnitOfMeasure?: string | null
  minimumAmount?: number | null
  minimumQuantity?: number | null
}

export interface OracleFusionSubscriptionUpdateChargeParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  chargePuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
  chargeName?: string | null
  chargeDefinition?: string | null
  priceType?: string
  unitListPrice?: number | null
  pricePeriodicity?: string | null
  billingFreq?: string | null
  invoicingRuleId?: string | null
  sequenceNumber?: number | null
  usageUnitOfMeasure?: string | null
  minimumAmount?: number | null
  minimumQuantity?: number | null
}

export interface OracleFusionSubscriptionDeleteChargeParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  chargePuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
}

export interface OracleFusionSubscriptionListChargeAdjustmentsParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  chargePuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
}

export interface OracleFusionSubscriptionGetChargeAdjustmentParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  chargePuid: string
  chargeAdjustmentPuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
}

export interface OracleFusionSubscriptionCreateChargeAdjustmentParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  chargePuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
  chargeAdjustmentPuid?: string | null
  adjustmentName?: string | null
  adjustmentType?: string | null
  adjustmentValue?: number | null
  adjustmentBasis?: string | null
  adjustmentReasonCode?: string | null
  effectivity?: string | null
  periodFrom?: number | null
  periodUntil?: number | null
  numberOfPeriods?: number | null
  validFrom?: string | null
  validUntil?: string | null
  revenueOptionChargeAdjustment?: string | null
  revenuePeriodChargeAdjustment?: string | null
  reason?: string | null
}

export interface OracleFusionSubscriptionUpdateChargeAdjustmentParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  chargePuid: string
  chargeAdjustmentPuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
  adjustmentName?: string | null
  adjustmentType?: string | null
  adjustmentValue?: number | null
  adjustmentBasis?: string | null
  adjustmentReasonCode?: string | null
  effectivity?: string | null
  periodFrom?: number | null
  periodUntil?: number | null
  numberOfPeriods?: number | null
  validFrom?: string | null
  validUntil?: string | null
  revenueOptionChargeAdjustment?: string | null
  revenuePeriodChargeAdjustment?: string | null
  reason?: string | null
}

export interface OracleFusionSubscriptionDeleteChargeAdjustmentParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  chargePuid: string
  chargeAdjustmentPuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
}

export interface OracleFusionSubscriptionListBillLinesParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
}

export interface OracleFusionSubscriptionGetBillLineParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  billLinePuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
}

export interface OracleFusionSubscriptionListBillAdjustmentsParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  billLinePuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
}

export interface OracleFusionSubscriptionGetBillAdjustmentParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  billLinePuid: string
  billAdjustmentPuid: string
  billingScope?: 'product' | 'covered_level'
  coveredLevelPuid?: string
}

export interface OracleFusionSubscriptionListValidationResultsParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {
  subscriptionNumber: string
}

export interface OracleFusionSubscriptionGetValidationResultParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  validationResultKey: string
}

export interface OracleFusionSubscriptionListSubscriptionProfilesParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {}

export interface OracleFusionSubscriptionGetSubscriptionProfileParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionProfileKey: string
}

export interface OracleFusionSubscriptionListSubscriptionItemsParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {}

export interface OracleFusionSubscriptionGetSubscriptionItemParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionItemKey: string
}

export interface OracleFusionSubscriptionListSubscriptionAssetsParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {}

export interface OracleFusionSubscriptionGetSubscriptionAssetParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionAssetKey: string
}

export interface OracleFusionSubscriptionListChildCoveredLevelsParams
  extends OracleFusionSubscriptionAuthParams,
    OracleFusionSubscriptionPageParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  coveredLevelPuid: string
}

export interface OracleFusionSubscriptionGetChildCoveredLevelParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  coveredLevelPuid: string
  childCoveredLevelPuid: string
}

export interface OracleFusionSubscriptionActivateSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  ignoreWarnings?: string | null
}

export interface OracleFusionSubscriptionCancelSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  canceledDate?: string | null
  cancelDescription?: string | null
  cancelReason?: string | null
}

export interface OracleFusionSubscriptionCloseSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  closeDescription?: string | null
  closedDate?: string | null
  overrideCreditAmount?: number | null
  closeCreditMethod?: string | null
  revenueOption?: string | null
  balanceTerminatedPartialPeriodOption?: string | null
  closeReason?: string | null
  creditType?: string | null
}

export interface OracleFusionSubscriptionHoldSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
}

export interface OracleFusionSubscriptionRemoveSubscriptionHoldParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
}

export interface OracleFusionSubscriptionRenewSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  duration?: number | null
  period?: string | null
  newSubscriptionNumber?: string | null
  revenueOption?: string | null
  ignoreWarning?: string | null
  revenueAction?: string | null
}

export interface OracleFusionSubscriptionValidateSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  ignoreWarnings?: string | null
}

export interface OracleFusionSubscriptionWithdrawSubscriptionParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
}

export interface OracleFusionSubscriptionAmendProductParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  copyCustomChildObjects?: string | null
  amendCreditMethod?: string | null
  defaultRevenueAction?: string | null
  copyCharges?: string | null
  copyAdjustments?: string | null
  creditType?: string | null
  amendDescription?: string | null
  amendReason?: string | null
  overrideCreditAmount?: number | null
  copyOneTimeCharges?: string | null
  revenueOption?: string | null
  balanceTermLineTerminatedPartialPeriodOption?: string | null
  lineNumber?: string | null
  amendEffectiveDate?: string | null
  balanceNewLineFirstPartialPeriodOption?: string | null
}

export interface OracleFusionSubscriptionCalculateProductCreditParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  closedDate?: string | null
  closeCreditMethod?: string | null
  coveredLevelPuid?: string | null
  externalAssetKey?: string | null
}

export interface OracleFusionSubscriptionCalculateProductTerminationFeeParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  closedDate?: string | null
}

export interface OracleFusionSubscriptionCancelProductParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  canceledDate?: string | null
  cancelDescription?: string | null
  cancelReason?: string | null
}

export interface OracleFusionSubscriptionCloseProductParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  closeDescription?: string | null
  closedDate?: string | null
  overrideCreditAmount?: number | null
  closeCreditMethod?: string | null
  revenueOption?: string | null
  balanceTerminatedPartialPeriodOption?: string | null
  earlyTerminationFee?: number | null
  closeReason?: string | null
  creditType?: string | null
}

export interface OracleFusionSubscriptionHoldProductParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
}

export interface OracleFusionSubscriptionRemoveProductHoldParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
}

export interface OracleFusionSubscriptionResumeProductParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  resumePeriod?: string | null
  resumeDuration?: number | null
  autoExtendFlag?: boolean | null
  resumeDate?: string | null
}

export interface OracleFusionSubscriptionSuspendProductParams
  extends OracleFusionSubscriptionAuthParams {
  subscriptionNumber: string
  subscriptionProductPuid: string
  suspendReason?: string | null
  resumePeriod?: string | null
  resumeDuration?: number | null
  suspendedDate?: string | null
  autoExtendFlag?: boolean | null
  resumeDate?: string | null
}
