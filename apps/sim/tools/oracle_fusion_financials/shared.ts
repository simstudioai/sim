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
    description: 'Short-lived bearer token injected from the selected credential',
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

const scalar = (description: string, type: OutputProperty['type'] = 'string'): OutputProperty => ({
  type,
  description,
  optional: true,
  nullable: true,
})

export const oracleFusionInvoiceOutputProperties = {
  invoiceUniqId: { type: 'string', description: 'Opaque Oracle invoice resource key' },
  InvoiceId: scalar('Oracle invoice identifier', 'number'),
  InvoiceNumber: scalar('Supplier invoice number'),
  Supplier: scalar('Supplier name'),
  SupplierNumber: scalar('Supplier number'),
  SupplierSite: scalar('Supplier site'),
  BusinessUnit: scalar('Invoice business unit'),
  InvoiceAmount: scalar('Invoice amount in transaction currency', 'number'),
  InvoiceCurrency: scalar('Invoice currency code'),
  InvoiceDate: scalar('Date on the supplier invoice'),
  AccountingDate: scalar('Invoice accounting date'),
  AmountPaid: scalar('Amount paid', 'number'),
  PaidStatus: scalar('Invoice paid status'),
  ApprovalStatus: scalar('Invoice approval status'),
  ValidationStatus: scalar('Invoice validation status'),
  PaymentTerms: scalar('Invoice payment terms'),
  PaymentMethod: scalar('Invoice payment method'),
  PurchaseOrderNumber: scalar('Matched purchase order number'),
  Description: scalar('Invoice description'),
  CreationDate: scalar('Record creation timestamp'),
  LastUpdateDate: scalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionInvoiceLineOutputProperties = {
  LineNumber: scalar('Invoice line number', 'number'),
  LineType: scalar('Invoice line type'),
  LineAmount: scalar('Line amount in invoice currency', 'number'),
  BaseAmount: scalar('Line amount in ledger currency', 'number'),
  Description: scalar('Invoice line description'),
  Quantity: scalar('Quantity invoiced', 'number'),
  UOM: scalar('Unit of measure'),
  UnitPrice: scalar('Unit price', 'number'),
  AccountingDate: scalar('Line accounting date'),
  ApprovalStatus: scalar('Invoice line approval status'),
  DiscardedFlag: scalar('Whether the line is discarded', 'boolean'),
  CanceledFlag: scalar('Whether the line is canceled', 'boolean'),
  TrackAsAssetFlag: scalar('Whether the line is tracked as an asset', 'boolean'),
  PurchaseOrderNumber: scalar('Matched purchase order number'),
  PurchaseOrderLineNumber: scalar('Matched purchase order line number', 'number'),
  ReceiptNumber: scalar('Matched receipt number'),
  ReceiptLineNumber: scalar('Matched receipt line number', 'number'),
  Item: scalar('Inventory item name'),
  ItemDescription: scalar('Inventory item description'),
  TaxClassification: scalar('Tax classification code'),
  TaxRateCode: scalar('Tax rate code'),
  ShipToLocation: scalar('Ship-to location'),
  CreationDate: scalar('Record creation timestamp'),
  LastUpdateDate: scalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionInstallmentOutputProperties = {
  InstallmentNumber: scalar('Invoice installment number', 'number'),
  DueDate: scalar('Installment due date'),
  GrossAmount: scalar('Gross installment amount', 'number'),
  UnpaidAmount: scalar('Unpaid installment amount', 'number'),
  PaymentMethod: scalar('Installment payment method'),
  PaymentPriority: scalar('Installment payment priority', 'number'),
  HoldFlag: scalar('Whether the installment is on hold', 'boolean'),
  HoldReason: scalar('Reason the installment is on hold'),
  FirstDiscountDate: scalar('First discount date'),
  FirstDiscountAmount: scalar('First discount amount', 'number'),
  SecondDiscountDate: scalar('Second discount date'),
  SecondDiscountAmount: scalar('Second discount amount', 'number'),
  ThirdDiscountDate: scalar('Third discount date'),
  ThirdDiscountAmount: scalar('Third discount amount', 'number'),
  CreationDate: scalar('Record creation timestamp'),
  LastUpdateDate: scalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>

export const oracleFusionPaymentOutputProperties = {
  CheckId: scalar('Unique Oracle payment identifier', 'number'),
  PaymentId: scalar('Payments application identifier', 'number'),
  PaymentReference: scalar('User- and bank-facing payment reference', 'number'),
  PaymentNumber: scalar('Payment or printed check number', 'number'),
  PaymentAmount: scalar('Payment amount', 'number'),
  PaymentCurrency: scalar('Payment currency code'),
  PaymentDate: scalar('Payment date'),
  AccountingDate: scalar('Payment accounting date'),
  Payee: scalar('Payee name'),
  PayeeSite: scalar('Payee supplier site'),
  SupplierNumber: scalar('Supplier number'),
  PaymentMethod: scalar('Payment method'),
  PaymentStatus: scalar('Payment status'),
  PaymentType: scalar('Payment type'),
  BusinessUnit: scalar('Payment business unit'),
  LegalEntity: scalar('Payment legal entity'),
  ReconciledFlag: scalar('Whether the payment is reconciled', 'boolean'),
  CreationDate: scalar('Record creation timestamp'),
  LastUpdateDate: scalar('Record last-update timestamp'),
} satisfies Record<string, OutputProperty>
