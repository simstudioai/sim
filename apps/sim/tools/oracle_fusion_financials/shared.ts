import type { OAuthConfig, OutputProperty, ToolConfig } from '@/tools/types'

export const ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG = {
  required: true,
  provider: 'oracle_fusion_financials',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const satisfies OAuthConfig

export const oracleFusionFinancialsAuthParamFields = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle Fusion Cloud Financials service-account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Basic-auth credential injected from the selected service account',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Canonical Fusion Applications origin injected from the selected credential',
  },
} satisfies ToolConfig['params']

export const oracleFusionFinancialsListParamFields = {
  q: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Oracle REST Framework q filter expression',
  },
  finder: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Oracle predefined finder expression',
  },
  orderBy: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Comma-separated Oracle attributes with optional :asc or :desc direction',
  },
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    default: 50,
    description: 'Records in this page (integer from 1 to 100; default 50)',
  },
  offset: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    default: 0,
    description: 'Zero-based record offset (non-negative integer; default 0)',
  },
  totalResults: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    default: false,
    description: 'Ask Oracle to include its estimated total matching row count',
  },
} satisfies ToolConfig['params']

export const oracleFusionInvoiceParamField = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Opaque invoice key returned by an Oracle Fusion invoice list or selector',
} as const

export const oracleFusionCheckIdParamField = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Oracle payment CheckId as a decimal string',
} as const

export const oracleFusionInvoiceLineParamField = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Opaque invoice-line key returned by Oracle Fusion',
} as const

export const oracleFusionInvoiceInstallmentParamField = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Opaque invoice-installment key returned by Oracle Fusion',
} as const

export const oracleFusionAppliedPrepaymentParamField = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Opaque applied-prepayment key returned by Oracle Fusion',
} as const

export const oracleFusionAvailablePrepaymentParamField = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Opaque available-prepayment key returned by Oracle Fusion',
} as const

export const oracleFusionPaymentTermLineParamField = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Opaque payment-term-line key returned by Oracle Fusion',
} as const

export function oracleFusionDecimalIdParamField(description: string) {
  return {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description,
  } as const
}

const scalar = (description: string, type: OutputProperty['type'] = 'string'): OutputProperty => ({
  type,
  description,
  optional: true,
  nullable: true,
})

const nonNullableScalar = (
  description: string,
  type: OutputProperty['type'] = 'string'
): OutputProperty => ({
  type,
  description,
  optional: true,
  nullable: false,
})

export const oracleFusionInvoiceOutputProperties = {
  invoiceUniqId: { type: 'string', description: 'Opaque Oracle invoice resource key' },
  InvoiceId: nonNullableScalar('Oracle invoice identifier as a decimal string'),
  InvoiceNumber: nonNullableScalar('Supplier invoice number'),
  Supplier: scalar('Supplier name'),
  SupplierNumber: nonNullableScalar('Supplier number'),
  SupplierSite: scalar('Supplier site'),
  BusinessUnit: nonNullableScalar('Invoice business unit'),
  InvoiceAmount: nonNullableScalar('Invoice amount in transaction currency', 'number'),
  InvoiceCurrency: nonNullableScalar('Invoice currency code'),
  InvoiceDate: nonNullableScalar('Date on the supplier invoice'),
  AccountingDate: nonNullableScalar('Invoice accounting date'),
  AmountPaid: scalar('Amount paid', 'number'),
  PaidStatus: nonNullableScalar('Invoice paid status'),
  ApprovalStatus: nonNullableScalar('Invoice approval status'),
  ValidationStatus: scalar('Invoice validation status'),
  PaymentTerms: nonNullableScalar('Invoice payment terms'),
  PaymentMethod: nonNullableScalar('Invoice payment method'),
  PurchaseOrderNumber: scalar('Matched purchase order number'),
  Description: scalar('Invoice description'),
  CreationDate: nonNullableScalar('Record creation timestamp'),
  LastUpdateDate: nonNullableScalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionInvoiceLineOutputProperties = {
  invoiceLineUniqId: { type: 'string', description: 'Opaque Oracle invoice-line resource key' },
  LineNumber: nonNullableScalar('Invoice line number as an exact decimal string'),
  LineType: scalar('Invoice line type'),
  LineAmount: scalar('Line amount in invoice currency', 'number'),
  BaseAmount: scalar('Line amount in ledger currency', 'number'),
  Description: scalar('Invoice line description'),
  Quantity: scalar('Quantity invoiced', 'number'),
  UOM: scalar('Unit of measure'),
  UnitPrice: scalar('Unit price', 'number'),
  AccountingDate: nonNullableScalar('Line accounting date'),
  ApprovalStatus: nonNullableScalar('Invoice line approval status'),
  DiscardedFlag: scalar('Whether the line is discarded', 'boolean'),
  CanceledFlag: scalar('Whether the line is canceled', 'boolean'),
  TrackAsAssetFlag: scalar('Whether the line is tracked as an asset', 'boolean'),
  PurchaseOrderNumber: scalar('Matched purchase order number'),
  PurchaseOrderLineNumber: scalar('Matched purchase order line number', 'number'),
  ReceiptNumber: scalar('Matched receipt number'),
  ReceiptLineNumber: scalar('Matched receipt line number as an exact decimal string'),
  Item: scalar('Inventory item name'),
  ItemDescription: scalar('Inventory item description'),
  TaxClassification: scalar('Tax classification code'),
  TaxRateCode: scalar('Tax rate code'),
  ShipToLocation: scalar('Ship-to location'),
  CreationDate: nonNullableScalar('Record creation timestamp'),
  LastUpdateDate: nonNullableScalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionInstallmentOutputProperties = {
  invoiceInstallmentUniqId: {
    type: 'string',
    description: 'Opaque Oracle invoice-installment resource key',
  },
  InstallmentNumber: nonNullableScalar('Invoice installment number as an exact decimal string'),
  DueDate: nonNullableScalar('Installment due date'),
  GrossAmount: nonNullableScalar('Gross installment amount', 'number'),
  UnpaidAmount: scalar('Unpaid installment amount', 'number'),
  PaymentMethod: nonNullableScalar('Installment payment method'),
  PaymentPriority: nonNullableScalar('Installment payment priority', 'number'),
  HoldFlag: scalar('Whether the installment is on hold', 'boolean'),
  HoldReason: scalar('Reason the installment is on hold'),
  FirstDiscountDate: scalar('First discount date'),
  FirstDiscountAmount: scalar('First discount amount', 'number'),
  SecondDiscountDate: scalar('Second discount date'),
  SecondDiscountAmount: scalar('Second discount amount', 'number'),
  ThirdDiscountDate: scalar('Third discount date'),
  ThirdDiscountAmount: scalar('Third discount amount', 'number'),
  CreationDate: nonNullableScalar('Record creation timestamp'),
  LastUpdateDate: nonNullableScalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionPaymentOutputProperties = {
  CheckId: nonNullableScalar('Unique Oracle payment identifier as a decimal string'),
  PaymentId: scalar('Payments application identifier as a decimal string'),
  PaymentReference: scalar('User- and bank-facing payment reference as a decimal string'),
  PaymentNumber: nonNullableScalar('Payment or printed check number as a decimal string'),
  PaymentAmount: nonNullableScalar('Payment amount', 'number'),
  PaymentCurrency: nonNullableScalar('Payment currency code'),
  PaymentDate: nonNullableScalar('Payment date'),
  AccountingDate: scalar('Payment accounting date'),
  Payee: scalar('Payee name'),
  PayeeSite: scalar('Payee supplier site'),
  SupplierNumber: nonNullableScalar('Supplier number'),
  PaymentMethod: nonNullableScalar('Payment method'),
  PaymentStatus: nonNullableScalar('Payment status'),
  PaymentType: scalar('Payment type'),
  BusinessUnit: nonNullableScalar('Payment business unit'),
  LegalEntity: nonNullableScalar('Payment legal entity'),
  ReconciledFlag: scalar('Whether the payment is reconciled', 'boolean'),
  CreationDate: nonNullableScalar('Record creation timestamp'),
  LastUpdateDate: nonNullableScalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionInvoiceDistributionOutputProperties = {
  InvoiceDistributionId: nonNullableScalar(
    'Oracle invoice distribution identifier as a decimal string'
  ),
  DistributionLineNumber: nonNullableScalar('Invoice distribution line number', 'number'),
  DistributionLineType: scalar('Invoice distribution line type'),
  DistributionAmount: nonNullableScalar('Invoice distribution amount', 'number'),
  BaseAmount: scalar('Distribution amount in ledger currency', 'number'),
  Description: scalar('Invoice distribution description'),
  AccountingDate: nonNullableScalar('Distribution accounting date'),
  AccountingStatus: nonNullableScalar('Distribution accounting status'),
  DistributionCombination: scalar('Accounting flexfield combination'),
  MatchedStatus: nonNullableScalar('Purchase-order match status'),
  FundsStatus: nonNullableScalar('Funds reservation status'),
  CanceledFlag: scalar('Whether the distribution is canceled', 'boolean'),
  ReversedFlag: scalar('Whether the distribution is part of a reversal pair', 'boolean'),
  PurchaseOrderNumber: nonNullableScalar('Matched purchase order number'),
  PurchaseOrderLineNumber: nonNullableScalar('Matched purchase order line number', 'number'),
  PurchaseOrderScheduleLineNumber: nonNullableScalar(
    'Matched purchase order schedule number',
    'number'
  ),
  PurchaseOrderDistributionLineNumber: nonNullableScalar(
    'Matched purchase order distribution number',
    'number'
  ),
  ReceiptNumber: scalar('Matched receipt number'),
  ReceiptLineNumber: nonNullableScalar('Matched receipt line number as an exact decimal string'),
  PrepaymentNumber: scalar('Applied prepayment invoice number'),
  PrepaymentLineNumber: scalar('Applied prepayment invoice line number'),
  TaxName: scalar('Tax name'),
  TaxRate: scalar('Tax rate value or percentage'),
  AssetBook: scalar('Candidate asset book'),
  TrackAsAssetFlag: nonNullableScalar('Whether the distribution is tracked as an asset', 'boolean'),
  CreationDate: nonNullableScalar('Record creation timestamp'),
  LastUpdateDate: nonNullableScalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionAppliedPrepaymentOutputProperties = {
  appliedPrepaymentUniqId: {
    type: 'string',
    description: 'Opaque Oracle applied-prepayment resource key',
  },
  InvoiceNumber: nonNullableScalar('Prepayment invoice number'),
  LineNumber: scalar('Prepayment invoice line number', 'number'),
  Description: scalar('Prepayment invoice line description'),
  SupplierSite: nonNullableScalar('Supplier site'),
  PurchaseOrder: scalar('Purchase order number'),
  Currency: nonNullableScalar('Invoice currency code'),
  AppliedAmount: scalar('Prepayment amount applied to the invoice', 'number'),
  IncludedTax: scalar('Tax amount included in the prepayment', 'number'),
  IncludedonInvoiceFlag: scalar('Whether the supplier invoice includes the prepayment', 'boolean'),
  ApplicationAccountingDate: nonNullableScalar('Prepayment application accounting date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionAvailablePrepaymentOutputProperties = {
  availablePrepaymentUniqId: {
    type: 'string',
    description: 'Opaque Oracle available-prepayment resource key',
  },
  InvoiceNumber: nonNullableScalar('Prepayment invoice number'),
  LineNumber: nonNullableScalar('Prepayment invoice line number as an exact decimal string'),
  Description: scalar('Prepayment invoice line description'),
  SupplierSite: nonNullableScalar('Supplier site'),
  PurchaseOrder: scalar('Purchase order number'),
  Currency: nonNullableScalar('Invoice currency code'),
  AvailableAmount: scalar('Prepayment amount available to apply', 'number'),
  IncludedTax: scalar('Tax amount included in the prepayment', 'number'),
} satisfies Record<string, OutputProperty>

export const oracleFusionPaymentRelatedInvoiceOutputProperties = {
  InvoicePaymentId: nonNullableScalar('Oracle invoice payment identifier as a decimal string'),
  CheckId: nonNullableScalar('Oracle payment identifier as a decimal string'),
  InvoiceId: nonNullableScalar('Oracle invoice identifier as a decimal string'),
  InvoiceBusinessUnit: scalar('Invoice business unit'),
  InvoiceNumber: nonNullableScalar('Supplier invoice number'),
  InstallmentNumber: nonNullableScalar('Invoice installment number as an exact decimal string'),
  AmountPaidPaymentCurrency: nonNullableScalar('Amount paid in payment currency', 'number'),
  AmountPaidInvoiceCurrency: scalar('Amount paid in invoice currency', 'number'),
  InvoiceAmount: scalar('Invoice amount', 'number'),
  InvoicePaymentAmount: scalar('Amount paid for the invoice', 'number'),
  InvoicePaymentStatus: scalar('Invoice payment status'),
  DiscountLost: scalar('Discount amount lost', 'number'),
  DiscountTaken: scalar('Discount amount taken', 'number'),
  InvoiceBaseAmount: scalar('Payment amount at the invoice conversion rate', 'number'),
  PaymentBaseAmount: scalar('Payment amount at the payment conversion rate', 'number'),
  InvoiceCurrency: scalar('Invoice currency code'),
  CrossCurrencyRate: scalar('Invoice-to-payment currency conversion rate', 'number'),
  CreationDate: nonNullableScalar('Record creation timestamp'),
  LastUpdateDate: nonNullableScalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionInvoiceHoldOutputProperties = {
  HoldId: nonNullableScalar('Oracle invoice hold identifier as a decimal string'),
  InvoiceNumber: scalar('Supplier invoice number'),
  BusinessUnit: scalar('Invoice business unit'),
  Supplier: scalar('Supplier name'),
  Party: scalar('Payment party'),
  LineHeld: scalar('Invoice line placed on hold', 'number'),
  HoldName: scalar('Hold name'),
  HoldReason: scalar('Reason for the hold'),
  HoldDetails: scalar('Detailed hold information'),
  HeldBy: scalar('User who placed the hold'),
  HoldDate: nonNullableScalar('Date and time the hold was placed'),
  ReleaseName: scalar('Hold release name'),
  ReleaseReason: scalar('Reason the hold was released'),
  ReleaseDate: scalar('Date and time the hold was released'),
  WorkflowStatus: nonNullableScalar('Hold resolution workflow status'),
  PurchaseOrderNumber: nonNullableScalar('Related purchase order number'),
  PurchaseOrderLineNumber: nonNullableScalar('Related purchase order line number', 'number'),
  PurchaseOrderScheduleLineNumber: nonNullableScalar(
    'Related purchase order schedule number',
    'number'
  ),
  ReceiptNumber: scalar('Related receipt number'),
  ReceiptLineNumber: nonNullableScalar('Related receipt line number as an exact decimal string'),
  CreationDate: nonNullableScalar('Record creation timestamp'),
  LastUpdateDate: nonNullableScalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionPaymentProcessRequestOutputProperties = {
  PaymentProcessRequestId: nonNullableScalar(
    'Payment process request identifier as a decimal string'
  ),
  PaymentProcessRequestName: nonNullableScalar('Payment process request name'),
  SourceApplicationIdentifier: nonNullableScalar(
    'Source application identifier as a decimal string'
  ),
  PaymentProcessRequestStatusCode: nonNullableScalar('Payment process request status code'),
  PaymentProcessRequestStatusMeaning: scalar('Payment process request status meaning'),
} satisfies Record<string, OutputProperty>

export const oracleFusionPaymentTermOutputProperties = {
  termsId: nonNullableScalar('Payment term identifier as a decimal string'),
  name: nonNullableScalar('Payment term name'),
  description: scalar('Payment term description'),
  enabledFlag: nonNullableScalar('Whether the payment term is enabled', 'boolean'),
  fromDate: nonNullableScalar('Date the payment term becomes valid'),
  toDate: scalar('Date the payment term becomes invalid'),
  cutoffDay: scalar('Monthly cutoff day', 'number'),
  rank: scalar('Payment term ranking as an exact decimal string'),
  setId: nonNullableScalar('Reference data set identifier as a decimal string'),
  creationDate: nonNullableScalar('Record creation timestamp'),
  lastUpdateDate: nonNullableScalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionPaymentTermLineOutputProperties = {
  paymentTermLineUniqId: {
    type: 'string',
    description: 'Opaque Oracle payment-term-line resource key',
  },
  termsId: nonNullableScalar('Payment term identifier as a decimal string'),
  sequenceNumber: nonNullableScalar('Payment term line sequence number', 'number'),
  amountDue: scalar('Maximum amount due by the calculated date', 'number'),
  calendar: scalar('Special calendar name'),
  dayOfMonth: scalar('Day of month used to calculate the due date', 'number'),
  days: scalar('Days after the terms date used to calculate the due date', 'number'),
  duePercent: scalar('Percentage of the payment due', 'number'),
  fixedDate: scalar('Fixed payment due date'),
  monthsAhead: scalar('Months ahead used to calculate the due date', 'number'),
  firstDiscountDayOfMonth: scalar('First discount day of month', 'number'),
  firstDiscountDays: scalar('Days used to calculate the first discount date', 'number'),
  firstDiscountMonthsForward: scalar('Months used to calculate the first discount date', 'number'),
  firstDiscountPercent: scalar('First discount percentage', 'number'),
  secondDiscountDayOfMonth: scalar('Second discount day of month', 'number'),
  secondDiscountDays: scalar('Days used to calculate the second discount date', 'number'),
  secondDiscountMonthsForward: scalar(
    'Months used to calculate the second discount date',
    'number'
  ),
  secondDiscountPercent: scalar('Second discount percentage', 'number'),
  thirdDiscountDayOfMonth: scalar('Third discount day of month', 'number'),
  thirdDiscountDays: scalar('Days used to calculate the third discount date', 'number'),
  thirdDiscountMonthsForward: scalar('Months used to calculate the third discount date', 'number'),
  thirdDiscountPercent: scalar('Third discount percentage', 'number'),
} satisfies Record<string, OutputProperty>
