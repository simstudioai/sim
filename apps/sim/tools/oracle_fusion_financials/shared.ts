import type { OAuthConfig, OutputProperty, ToolConfig } from '@/tools/types'

export const oracleFusionFinancialsPageOutputProperties = {
  count: { type: 'number', description: 'Number of records in this page' },
  hasMore: { type: 'boolean', description: 'Whether Oracle has another page' },
  limit: { type: 'number', description: 'Page size returned by Oracle' },
  offset: { type: 'number', description: 'Offset returned by Oracle' },
  totalResults: {
    type: 'number',
    description: 'Estimated total matching records when requested',
    optional: true,
  },
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesInvoiceLineCreateItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    LineNumber: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    Description: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    ItemNumber: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    MemoLine: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    LineAmount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    Quantity: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    UnitSellingPrice: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    UnitOfMeasure: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    AccountingRule: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    AccountingRuleDuration: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Exact decimal integer supplied as a string',
    },
    RuleStartDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    RuleEndDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    TaxClassificationCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    SalesOrder: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const

export const oracleFusionReceivablesInvoiceDistributionCreateItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    AccountClass: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    AccountCombination: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    AccountedAmount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    Amount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    InvoiceLineNumber: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    DetailedTaxLineNumber: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    Percent: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    Comments: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const

export const oracleFusionReceivablesCreditMemoLineCreateItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['LineNumber'],
  properties: {
    LineNumber: { type: 'number' },
    LineDescription: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    ItemNumber: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    MemoLine: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    LineAmountCredit: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    LineQuantityCredit: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    UnitSellingPrice: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    UnitOfMeasure: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    LineCreditReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    LineFreightCreditAmount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    TaxClassificationCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const

export const oracleFusionReceivablesCreditMemoDistributionCreateItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    AccountClass: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    AccountCombination: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    AccountedAmount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    Amount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    CreditMemoLineNumber: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    DetailedTaxLineNumber: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    Percent: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    Comments: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const

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

export const oracleFusionReceivablesInvoiceOutputProperties = {
  CustomerTransactionId: nonNullableScalar('Customer Transaction Id as an exact decimal string'),
  TransactionNumber: scalar('Transaction Number'),
  BillToCustomerName: scalar('Bill To Customer Name'),
  BillToCustomerNumber: scalar('Bill To Customer Number'),
  BillToSite: scalar('Bill To Site'),
  BusinessUnit: scalar('Business Unit'),
  TransactionDate: scalar('Transaction Date'),
  AccountingDate: scalar('Accounting Date'),
  DueDate: scalar('Due Date'),
  InvoiceCurrencyCode: scalar('Invoice Currency Code'),
  EnteredAmount: scalar('Entered Amount', 'number'),
  InvoiceBalanceAmount: scalar('Invoice Balance Amount', 'number'),
  InvoiceStatus: scalar('Invoice Status'),
  PaymentTerms: scalar('Payment Terms'),
  TransactionSource: scalar('Transaction Source'),
  TransactionType: scalar('Transaction Type'),
  Comments: scalar('Comments'),
  CreationDate: nonNullableScalar('Creation Date'),
  LastUpdateDate: nonNullableScalar('Last Update Date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesInvoiceLineOutputProperties = {
  CustomerTransactionLineId: nonNullableScalar(
    'Customer Transaction Line Id as an exact decimal string'
  ),
  LineNumber: scalar('Line Number', 'number'),
  Description: scalar('Description'),
  ItemNumber: scalar('Item Number'),
  MemoLine: scalar('Memo Line'),
  LineAmount: scalar('Line Amount', 'number'),
  Quantity: scalar('Quantity', 'number'),
  UnitSellingPrice: scalar('Unit Selling Price', 'number'),
  UnitOfMeasure: scalar('Unit Of Measure'),
  AccountingRule: scalar('Accounting Rule'),
  AccountingRuleDuration: scalar('Accounting Rule Duration as an exact decimal string'),
  RuleStartDate: scalar('Rule Start Date'),
  RuleEndDate: scalar('Rule End Date'),
  TaxClassificationCode: scalar('Tax Classification Code'),
  CreationDate: nonNullableScalar('Creation Date'),
  LastUpdateDate: nonNullableScalar('Last Update Date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesInvoiceDistributionOutputProperties = {
  DistributionId: nonNullableScalar('Distribution Id as an exact decimal string'),
  AccountClass: scalar('Account Class'),
  AccountCombination: scalar('Account Combination'),
  AccountedAmount: scalar('Accounted Amount', 'number'),
  Amount: scalar('Amount', 'number'),
  InvoiceLineNumber: scalar('Invoice Line Number', 'number'),
  DetailedTaxLineNumber: scalar('Detailed Tax Line Number', 'number'),
  Percent: scalar('Percent', 'number'),
  Comments: scalar('Comments'),
  CreationDate: nonNullableScalar('Creation Date'),
  LastUpdateDate: nonNullableScalar('Last Update Date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesInvoiceInstallmentOutputProperties = {
  InstallmentId: nonNullableScalar('Installment Id as an exact decimal string'),
  InstallmentSequenceNumber: scalar('Installment Sequence Number as an exact decimal string'),
  InstallmentDueDate: nonNullableScalar('Installment Due Date'),
  OriginalAmount: nonNullableScalar('Original Amount', 'number'),
  InstallmentBalanceDue: nonNullableScalar('Installment Balance Due', 'number'),
  AccountedBalanceDue: nonNullableScalar('Accounted Balance Due', 'number'),
  AmountPaid: scalar('Amount Paid', 'number'),
  InstallmentAmountAdjusted: scalar('Installment Amount Adjusted', 'number'),
  InstallmentAmountCredited: scalar('Installment Amount Credited', 'number'),
  InstallmentStatus: scalar('Installment Status'),
  DisputeAmount: scalar('Dispute Amount', 'number'),
  DisputeDate: scalar('Dispute Date'),
  PaymentDaysLate: scalar('Payment Days Late', 'number'),
  CreationDate: nonNullableScalar('Creation Date'),
  LastUpdateDate: nonNullableScalar('Last Update Date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesCreditMemoOutputProperties = {
  CustomerTransactionId: nonNullableScalar('Customer Transaction Id as an exact decimal string'),
  TransactionNumber: nonNullableScalar('Transaction Number'),
  BusinessUnit: nonNullableScalar('Business Unit'),
  BillToCustomerName: scalar('Bill To Customer Name'),
  BillToCustomerNumber: scalar('Bill To Customer Number'),
  BillToSite: scalar('Bill To Site'),
  TransactionDate: nonNullableScalar('Transaction Date'),
  AccountingDate: scalar('Accounting Date'),
  CreditMemoCurrency: scalar('Credit Memo Currency'),
  CreditMemoStatus: scalar('Credit Memo Status'),
  CreditReason: scalar('Credit Reason'),
  EnteredAmount: scalar('Entered Amount', 'number'),
  TransactionBalanceDue: scalar('Transaction Balance Due', 'number'),
  FreightCreditAmount: scalar('Freight Credit Amount'),
  TransactionSource: scalar('Transaction Source'),
  TransactionType: scalar('Transaction Type'),
  CreditMemoComments: scalar('Credit Memo Comments'),
  CreationDate: nonNullableScalar('Creation Date'),
  LastUpdateDate: nonNullableScalar('Last Update Date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesCreditMemoLineOutputProperties = {
  CustomerTransactionLineId: nonNullableScalar(
    'Customer Transaction Line Id as an exact decimal string'
  ),
  LineNumber: nonNullableScalar('Line Number', 'number'),
  LineDescription: scalar('Line Description'),
  ItemNumber: scalar('Item Number'),
  MemoLine: scalar('Memo Line'),
  LineAmountCredit: scalar('Line Amount Credit', 'number'),
  LineQuantityCredit: scalar('Line Quantity Credit', 'number'),
  UnitSellingPrice: scalar('Unit Selling Price', 'number'),
  UnitOfMeasure: scalar('Unit Of Measure'),
  LineCreditReason: scalar('Line Credit Reason'),
  LineFreightCreditAmount: scalar('Line Freight Credit Amount', 'number'),
  TaxClassificationCode: scalar('Tax Classification Code'),
  CreationDate: nonNullableScalar('Creation Date'),
  LastUpdateDate: nonNullableScalar('Last Update Date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesCreditMemoDistributionOutputProperties = {
  DistributionId: nonNullableScalar('Distribution Id as an exact decimal string'),
  AccountClass: scalar('Account Class'),
  AccountCombination: scalar('Account Combination'),
  AccountedAmount: scalar('Accounted Amount', 'number'),
  Amount: scalar('Amount', 'number'),
  CreditMemoLineNumber: scalar('Credit Memo Line Number', 'number'),
  DetailedTaxLineNumber: scalar('Detailed Tax Line Number', 'number'),
  Percent: scalar('Percent', 'number'),
  Comments: scalar('Comments'),
  CreationDate: nonNullableScalar('Creation Date'),
  LastUpdateDate: nonNullableScalar('Last Update Date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesReceiptOutputProperties = {
  StandardReceiptId: nonNullableScalar('Standard Receipt Id as an exact decimal string'),
  ReceiptNumber: scalar('Receipt Number'),
  Amount: nonNullableScalar('Amount', 'number'),
  AccountedAmount: nonNullableScalar('Accounted Amount', 'number'),
  UnappliedAmount: scalar('Unapplied Amount', 'number'),
  Currency: nonNullableScalar('Currency'),
  BusinessUnit: nonNullableScalar('Business Unit'),
  ReceiptDate: nonNullableScalar('Receipt Date'),
  AccountingDate: scalar('Accounting Date'),
  ReceiptMethod: nonNullableScalar('Receipt Method'),
  CustomerName: scalar('Customer Name'),
  CustomerAccountNumber: scalar('Customer Account Number'),
  CustomerSite: scalar('Customer Site'),
  State: scalar('State'),
  Status: scalar('Status'),
  Comments: scalar('Comments'),
  CreationDate: nonNullableScalar('Creation Date'),
  LastUpdateDate: nonNullableScalar('Last Update Date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesCustomerAccountOutputProperties = {
  AccountId: nonNullableScalar('Account Id as an exact decimal string'),
  AccountNumber: nonNullableScalar('Account Number'),
  CustomerId: nonNullableScalar('Customer Id as an exact decimal string'),
  CustomerName: nonNullableScalar('Customer Name'),
  TotalOpenReceivablesForAccount: scalar('Total Open Receivables For Account', 'number'),
  TotalTransactionsDueForAccount: scalar('Total Transactions Due For Account', 'number'),
  CreationDate: nonNullableScalar('Creation Date'),
  LastUpdateDate: nonNullableScalar('Last Update Date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesCustomerAccountSiteOutputProperties = {
  BillToSiteUseId: nonNullableScalar('Bill To Site Use Id as an exact decimal string'),
  BillToSiteNumber: nonNullableScalar('Bill To Site Number'),
  BillToSiteAddress: scalar('Bill To Site Address'),
  AccountId: nonNullableScalar('Account Id as an exact decimal string'),
  AccountNumber: nonNullableScalar('Account Number'),
  CustomerId: nonNullableScalar('Customer Id as an exact decimal string'),
  CustomerName: nonNullableScalar('Customer Name'),
  TotalOpenReceivablesForSite: scalar('Total Open Receivables For Site', 'number'),
  TotalTransactionsDueForSite: scalar('Total Transactions Due For Site', 'number'),
  CreationDate: nonNullableScalar('Creation Date'),
  LastUpdateDate: nonNullableScalar('Last Update Date'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesReceiptApplicationOutputProperties = {
  ApplicationId: nonNullableScalar('Application Id as an exact decimal string'),
  StandardReceiptId: nonNullableScalar('Standard Receipt Id as an exact decimal string'),
  ReceiptNumber: scalar('Receipt Number'),
  ApplicationAmount: nonNullableScalar('Application Amount', 'number'),
  EnteredCurrency: nonNullableScalar('Entered Currency'),
  ApplicationDate: nonNullableScalar('Application Date'),
  AccountingDate: nonNullableScalar('Accounting Date'),
  ApplicationStatus: scalar('Application Status'),
  ProcessStatus: scalar('Process Status'),
  IsLatestApplication: nonNullableScalar('Is Latest Application'),
  ReferenceInstallmentId: scalar('Reference Installment Id as an exact decimal string'),
  ReferenceTransactionId: nonNullableScalar('Reference Transaction Id as an exact decimal string'),
  ReferenceTransactionNumber: scalar('Reference Transaction Number'),
  ReferenceTransactionStatus: scalar('Reference Transaction Status'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesCreditMemoApplicationOutputProperties = {
  ApplicationId: nonNullableScalar('Application Id as an exact decimal string'),
  CreditMemoId: nonNullableScalar('Credit Memo Id as an exact decimal string'),
  CreditMemoNumber: nonNullableScalar('Credit Memo Number'),
  ApplicationAmount: nonNullableScalar('Application Amount', 'number'),
  EnteredCurrency: scalar('Entered Currency'),
  ApplicationDate: nonNullableScalar('Application Date'),
  AccountingDate: nonNullableScalar('Accounting Date'),
  ApplicationStatus: scalar('Application Status'),
  CreditMemoStatus: scalar('Credit Memo Status'),
  IsLatestApplication: nonNullableScalar('Is Latest Application'),
  ReferenceInstallmentId: scalar('Reference Installment Id as an exact decimal string'),
  ReferenceTransactionId: nonNullableScalar('Reference Transaction Id as an exact decimal string'),
  ReferenceTransactionNumber: scalar('Reference Transaction Number'),
  ReferenceTransactionStatus: scalar('Reference Transaction Status'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesTransactionPaymentScheduleOutputProperties = {
  InstallmentId: nonNullableScalar('Installment Id as an exact decimal string'),
  InstallmentNumber: scalar('Installment Number as an exact decimal string'),
  InstallmentStatus: scalar('Installment Status'),
  TransactionId: nonNullableScalar('Transaction Id as an exact decimal string'),
  TransactionNumber: nonNullableScalar('Transaction Number'),
  TransactionClass: scalar('Transaction Class'),
  TransactionType: scalar('Transaction Type'),
  TransactionSourceName: nonNullableScalar('Transaction Source Name'),
  TransactionDate: nonNullableScalar('Transaction Date'),
  PaymentScheduleDueDate: nonNullableScalar('Payment Schedule Due Date'),
  PaymentDaysLate: scalar('Payment Days Late', 'number'),
  TotalBalanceAmount: nonNullableScalar('Total Balance Amount', 'number'),
  TotalOriginalAmount: nonNullableScalar('Total Original Amount', 'number'),
  EnteredCurrency: scalar('Entered Currency'),
  BillToSiteNumber: nonNullableScalar('Bill To Site Number'),
  PurchaseOrder: scalar('Purchase Order'),
} satisfies Record<string, OutputProperty>

export const oracleFusionReceivablesTransactionAdjustmentOutputProperties = {
  AdjustmentId: nonNullableScalar('Adjustment Id as an exact decimal string'),
  AdjustmentNumber: nonNullableScalar('Adjustment Number'),
  AdjustmentAmount: nonNullableScalar('Adjustment Amount', 'number'),
  AdjustmentReason: scalar('Adjustment Reason'),
  AdjustmentType: scalar('Adjustment Type'),
  EnteredCurrency: scalar('Entered Currency'),
  AccountingDate: nonNullableScalar('Accounting Date'),
  ApplicationDate: scalar('Application Date'),
  ProcessStatus: scalar('Process Status'),
  ReferenceInstallmentId: scalar('Reference Installment Id as an exact decimal string'),
  ReferenceTransactionId: nonNullableScalar('Reference Transaction Id as an exact decimal string'),
  ReferenceTransactionNumber: nonNullableScalar('Reference Transaction Number'),
  ReferenceTransactionStatus: scalar('Reference Transaction Status'),
} satisfies Record<string, OutputProperty>

export const oracleFusionExpenseReportOutputProperties = {
  expenseReportUniqId: { type: 'string', description: 'Oracle-derived opaque resource key' },
  ExpenseReportId: nonNullableScalar('Expense Report Id', 'string'),
  ExpenseReportNumber: scalar('Expense Report Number', 'string'),
  ExpenseReportStatus: nonNullableScalar('Expense Report Status', 'string'),
  ExpenseStatusCode: scalar('Expense Status Code', 'string'),
  ExpenseReportTotal: scalar('Expense Report Total', 'number'),
  BusinessUnit: scalar('Business Unit', 'string'),
  OrgId: nonNullableScalar('Org Id', 'string'),
  AssignmentId: scalar('Assignment Id', 'string'),
  PersonId: scalar('Person Id', 'string'),
  PersonName: scalar('Person Name', 'string'),
  Purpose: scalar('Purpose', 'string'),
  ExpenseReportDate: scalar('Expense Report Date', 'string'),
  ReportSubmitDate: scalar('Report Submit Date', 'string'),
  ReimbursementCurrencyCode: scalar('Reimbursement Currency Code', 'string'),
  PaymentMethodCode: scalar('Payment Method Code', 'string'),
  SubmitErrors: scalar('Submit Errors', 'string'),
  CreationDate: nonNullableScalar('Creation Date', 'string'),
  LastUpdateDate: nonNullableScalar('Last Update Date', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionExpenseLineOutputProperties = {
  expenseLineUniqId: { type: 'string', description: 'Oracle-derived opaque resource key' },
  ExpenseId: nonNullableScalar('Expense Id', 'string'),
  ExpenseReportId: scalar('Expense Report Id', 'string'),
  ExpenseReference: nonNullableScalar('Expense Reference', 'number'),
  ExpenseType: scalar('Expense Type', 'string'),
  ExpenseTypeId: scalar('Expense Type Id', 'string'),
  ExpenseTemplate: scalar('Expense Template', 'string'),
  ExpenseTemplateId: scalar('Expense Template Id', 'string'),
  BusinessUnit: scalar('Business Unit', 'string'),
  OrgId: nonNullableScalar('Org Id', 'string'),
  AssignmentId: nonNullableScalar('Assignment Id', 'string'),
  PersonId: nonNullableScalar('Person Id', 'string'),
  PersonName: scalar('Person Name', 'string'),
  Description: scalar('Description', 'string'),
  Justification: scalar('Justification', 'string'),
  ReceiptAmount: scalar('Receipt Amount', 'number'),
  ReceiptCurrencyCode: scalar('Receipt Currency Code', 'string'),
  ReceiptDate: scalar('Receipt Date', 'string'),
  ReimbursableAmount: scalar('Reimbursable Amount', 'number'),
  ReimbursementCurrencyCode: scalar('Reimbursement Currency Code', 'string'),
  MerchantName: scalar('Merchant Name', 'string'),
  StartDate: scalar('Start Date', 'string'),
  EndDate: scalar('End Date', 'string'),
  ItemizationParentExpenseId: scalar('Itemization Parent Expense Id', 'string'),
  ReceiptMissingFlag: scalar('Receipt Missing Flag', 'boolean'),
  ImageReceiptRequiredFlag: scalar('Image Receipt Required Flag', 'boolean'),
  ValidationErrorFlag: scalar('Validation Error Flag', 'boolean'),
  ValidationErrorMessages: scalar('Validation Error Messages', 'string'),
  ValidationWarningMessages: scalar('Validation Warning Messages', 'string'),
  CreationDate: nonNullableScalar('Creation Date', 'string'),
  LastUpdateDate: nonNullableScalar('Last Update Date', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionExpenseDistributionOutputProperties = {
  ExpenseDistId: nonNullableScalar('Expense Dist Id', 'string'),
  ExpenseId: nonNullableScalar('Expense Id', 'string'),
  ExpenseReportId: scalar('Expense Report Id', 'string'),
  OrgId: nonNullableScalar('Org Id', 'string'),
  BusinessUnit: scalar('Business Unit', 'string'),
  CodeCombinationId: scalar('Code Combination Id', 'string'),
  Company: scalar('Company', 'string'),
  CostCenter: scalar('Cost Center', 'string'),
  ReimbursableAmount: scalar('Reimbursable Amount', 'number'),
  CreationDate: nonNullableScalar('Creation Date', 'string'),
  LastUpdateDate: nonNullableScalar('Last Update Date', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionExpenseItemizationOutputProperties = {
  ExpenseId: nonNullableScalar('Expense Id', 'string'),
  ExpenseReportId: scalar('Expense Report Id', 'string'),
  ItemizationParentExpenseId: scalar('Itemization Parent Expense Id', 'string'),
  OrgId: nonNullableScalar('Org Id', 'string'),
  AssignmentId: nonNullableScalar('Assignment Id', 'string'),
  PersonId: nonNullableScalar('Person Id', 'string'),
  ExpenseType: scalar('Expense Type', 'string'),
  ExpenseTypeId: scalar('Expense Type Id', 'string'),
  Description: scalar('Description', 'string'),
  Justification: scalar('Justification', 'string'),
  ReceiptAmount: scalar('Receipt Amount', 'number'),
  ReceiptCurrencyCode: scalar('Receipt Currency Code', 'string'),
  ReceiptDate: scalar('Receipt Date', 'string'),
  ReimbursableAmount: scalar('Reimbursable Amount', 'number'),
  ReimbursementCurrencyCode: scalar('Reimbursement Currency Code', 'string'),
  MerchantName: scalar('Merchant Name', 'string'),
  StartDate: scalar('Start Date', 'string'),
  EndDate: scalar('End Date', 'string'),
  ImgReceiptRequiredFlag: scalar('Img Receipt Required Flag', 'boolean'),
  ValidationErrorFlag: scalar('Validation Error Flag', 'boolean'),
  ValidationErrorMessages: scalar('Validation Error Messages', 'string'),
  ValidationWarningMessages: scalar('Validation Warning Messages', 'string'),
  CreationDate: nonNullableScalar('Creation Date', 'string'),
  LastUpdateDate: nonNullableScalar('Last Update Date', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionExpenseReportProcessingDetailOutputProperties = {
  expenseReportProcessingDetailUniqId: {
    type: 'string',
    description: 'Oracle-derived opaque resource key',
  },
  ExpenseReportProcessingId: nonNullableScalar('Expense Report Processing Id', 'number'),
  ExpenseReportId: nonNullableScalar('Expense Report Id', 'string'),
  Event: nonNullableScalar('Event', 'string'),
  EventDate: scalar('Event Date', 'string'),
  EventPerformerId: scalar('Event Performer Id', 'string'),
  EventPerformerName: scalar('Event Performer Name', 'string'),
  AuditCode: scalar('Audit Code', 'string'),
  AuditReturnReasonCode: scalar('Audit Return Reason Code', 'string'),
  CreationDate: nonNullableScalar('Creation Date', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionExpenseReportPaymentOutputProperties = {
  ExpenseReportId: nonNullableScalar('Expense Report Id', 'string'),
  InvoiceId: nonNullableScalar('Invoice Id', 'string'),
  CheckId: nonNullableScalar('Check Id', 'string'),
  CheckNumber: nonNullableScalar('Check Number', 'string'),
  PaymentNumber: nonNullableScalar('Payment Number', 'string'),
  PaymentAmount: nonNullableScalar('Payment Amount', 'number'),
  PaymentCurrencyCode: scalar('Payment Currency Code', 'string'),
  PaymentDate: nonNullableScalar('Payment Date', 'string'),
  PaymentMethod: scalar('Payment Method', 'string'),
  PaymentMethodCode: scalar('Payment Method Code', 'string'),
  ProcessingType: nonNullableScalar('Processing Type', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionExpenseLineErrorOutputProperties = {
  ErrorSequence: scalar('Error Sequence', 'number'),
  ErrorCode: scalar('Error Code', 'string'),
  ErrorDescription: scalar('Error Description', 'string'),
  Name: scalar('Name', 'string'),
  Type: scalar('Type', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionGlLedgerOutputProperties = {
  LedgerId: scalar('Ledger Id', 'string'),
  Name: nonNullableScalar('Name', 'string'),
  Description: scalar('Description', 'string'),
  CurrencyCode: nonNullableScalar('Currency Code', 'string'),
  ChartOfAccountsId: nonNullableScalar('Chart Of Accounts Id', 'string'),
  AccountedPeriodType: nonNullableScalar('Accounted Period Type', 'string'),
  PeriodSetName: nonNullableScalar('Period Set Name', 'string'),
  LedgerCategoryCode: nonNullableScalar('Ledger Category Code', 'string'),
  LedgerTypeCode: nonNullableScalar('Ledger Type Code', 'string'),
  EnableBudgetaryControlFlag: nonNullableScalar('Enable Budgetary Control Flag', 'boolean'),
} satisfies Record<string, OutputProperty>

export const oracleFusionGlJournalBatchOutputProperties = {
  JeBatchId: nonNullableScalar('Je Batch Id', 'string'),
  BatchName: nonNullableScalar('Batch Name', 'string'),
  BatchDescription: scalar('Batch Description', 'string'),
  DefaultPeriodName: scalar('Default Period Name', 'string'),
  Status: nonNullableScalar('Status', 'string'),
  StatusMeaning: scalar('Status Meaning', 'string'),
  CompletionStatusMeaning: scalar('Completion Status Meaning', 'string'),
  ApprovalStatusMeaning: nonNullableScalar('Approval Status Meaning', 'string'),
  FundsStatusMeaning: nonNullableScalar('Funds Status Meaning', 'string'),
  UserJeSourceName: nonNullableScalar('User Je Source Name', 'string'),
  ChartOfAccountsName: nonNullableScalar('Chart Of Accounts Name', 'string'),
  UserPeriodSetName: nonNullableScalar('User Period Set Name', 'string'),
  AccountedPeriodType: nonNullableScalar('Accounted Period Type', 'string'),
  ActualFlagMeaning: nonNullableScalar('Actual Flag Meaning', 'string'),
  RunningTotalCr: scalar('Running Total Cr', 'number'),
  RunningTotalDr: scalar('Running Total Dr', 'number'),
  RunningTotalAccountedCr: scalar('Running Total Accounted Cr', 'number'),
  RunningTotalAccountedDr: scalar('Running Total Accounted Dr', 'number'),
  ControlTotal: scalar('Control Total', 'number'),
  PostedDate: scalar('Posted Date', 'string'),
  ReversalFlag: scalar('Reversal Flag', 'boolean'),
  ReversalDate: scalar('Reversal Date', 'string'),
  ReversalMethodMeaning: scalar('Reversal Method Meaning', 'string'),
  ReversalPeriod: scalar('Reversal Period', 'string'),
  ErrorMessage: scalar('Error Message', 'string'),
  CreationDate: nonNullableScalar('Creation Date', 'string'),
  LastUpdateDate: nonNullableScalar('Last Update Date', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionGlJournalHeaderOutputProperties = {
  glJournalHeaderUniqId: { type: 'string', description: 'Oracle-derived opaque resource key' },
  JournalName: nonNullableScalar('Journal Name', 'string'),
  JournalDescription: scalar('Journal Description', 'string'),
  LedgerName: nonNullableScalar('Ledger Name', 'string'),
  LedgerCurrencyCode: nonNullableScalar('Ledger Currency Code', 'string'),
  CurrencyCode: scalar('Currency Code', 'string'),
  PeriodName: nonNullableScalar('Period Name', 'string'),
  DefaultEffectiveDate: nonNullableScalar('Default Effective Date', 'string'),
  UserJeCategoryName: nonNullableScalar('User Je Category Name', 'string'),
  UserCurrencyConversionType: nonNullableScalar('User Currency Conversion Type', 'string'),
  CurrencyConversionDate: scalar('Currency Conversion Date', 'string'),
  CurrencyConversionRate: scalar('Currency Conversion Rate', 'number'),
  RunningTotalCr: scalar('Running Total Cr', 'number'),
  RunningTotalDr: scalar('Running Total Dr', 'number'),
  RunningTotalAccountedCr: scalar('Running Total Accounted Cr', 'number'),
  RunningTotalAccountedDr: scalar('Running Total Accounted Dr', 'number'),
  ControlTotal: scalar('Control Total', 'number'),
  LegalEntityName: nonNullableScalar('Legal Entity Name', 'string'),
  ExternalReference: scalar('External Reference', 'string'),
  AccrualReversalStatus: scalar('Accrual Reversal Status', 'string'),
  CreationDate: nonNullableScalar('Creation Date', 'string'),
  LastUpdateDate: nonNullableScalar('Last Update Date', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionGlJournalLineOutputProperties = {
  glJournalLineUniqId: { type: 'string', description: 'Oracle-derived opaque resource key' },
  JeLineNumber: nonNullableScalar('Je Line Number', 'string'),
  AccountCombination: scalar('Account Combination', 'string'),
  AccountedCr: scalar('Accounted Cr', 'number'),
  AccountedDr: scalar('Accounted Dr', 'number'),
  EnteredCr: scalar('Entered Cr', 'number'),
  EnteredDr: scalar('Entered Dr', 'number'),
  CurrencyCode: nonNullableScalar('Currency Code', 'string'),
  CurrencyConversionDate: nonNullableScalar('Currency Conversion Date', 'string'),
  CurrencyConversionRate: nonNullableScalar('Currency Conversion Rate', 'number'),
  Description: scalar('Description', 'string'),
  ChartOfAccountsName: nonNullableScalar('Chart Of Accounts Name', 'string'),
  StatAmount: scalar('Stat Amount', 'number'),
  ReconciliationReference: scalar('Reconciliation Reference', 'string'),
  jgzzReconStatusMeaning: nonNullableScalar('Jgzz Recon Status Meaning', 'string'),
  CreationDate: nonNullableScalar('Creation Date', 'string'),
  LastUpdateDate: nonNullableScalar('Last Update Date', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionGlJournalErrorOutputProperties = {
  glJournalErrorUniqId: { type: 'string', description: 'Oracle-derived opaque resource key' },
  BatchName: nonNullableScalar('Batch Name', 'string'),
  HeaderName: scalar('Header Name', 'string'),
  ErrorNumber: nonNullableScalar('Error Number', 'string'),
  JeLineNumber: nonNullableScalar('Je Line Number', 'string'),
  ErrorMessage: scalar('Error Message', 'string'),
  ErrorMessageName: scalar('Error Message Name', 'string'),
  CreationDate: nonNullableScalar('Creation Date', 'string'),
  LastUpdateDate: nonNullableScalar('Last Update Date', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionGlJournalActionLogOutputProperties = {
  glJournalActionLogUniqId: { type: 'string', description: 'Oracle-derived opaque resource key' },
  ActionCodeMeaning: nonNullableScalar('Action Code Meaning', 'string'),
  ActionDate: nonNullableScalar('Action Date', 'string'),
  UserName: scalar('User Name', 'string'),
  CreationDate: nonNullableScalar('Creation Date', 'string'),
  LastUpdateDate: nonNullableScalar('Last Update Date', 'string'),
} satisfies Record<string, OutputProperty>

export const oracleFusionGlBalanceOutputProperties = {
  AccountCombination: scalar('Account Combination', 'string'),
  AccountGroupName: scalar('Account Group Name', 'string'),
  AccountName: scalar('Account Name', 'string'),
  ActualBalance: scalar('Actual Balance', 'string'),
  AmountType: scalar('Amount Type', 'string'),
  BeginningBalance: scalar('Beginning Balance', 'string'),
  BudgetBalance: scalar('Budget Balance', 'string'),
  Currency: scalar('Currency', 'string'),
  CurrencyType: scalar('Currency Type', 'string'),
  CurrentAccountingPeriod: scalar('Current Accounting Period', 'string'),
  CurrentPeriodBalance: scalar('Current Period Balance', 'string'),
  DetailAccountCombination: scalar('Detail Account Combination', 'string'),
  EndingBalance: scalar('Ending Balance', 'string'),
  ErrorDetail: scalar('Error Detail', 'string'),
  LedgerName: scalar('Ledger Name', 'string'),
  LedgerSetName: scalar('Ledger Set Name', 'string'),
  PeriodActivity: scalar('Period Activity', 'string'),
  PeriodName: scalar('Period Name', 'string'),
  Scenario: scalar('Scenario', 'string'),
} satisfies Record<string, OutputProperty>
