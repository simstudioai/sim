import { z } from 'zod'
import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'

export const ORACLE_FUSION_INVOICE_FIELDS = [
  'InvoiceId',
  'InvoiceNumber',
  'Supplier',
  'SupplierNumber',
  'SupplierSite',
  'BusinessUnit',
  'InvoiceAmount',
  'InvoiceCurrency',
  'InvoiceDate',
  'AccountingDate',
  'AmountPaid',
  'PaidStatus',
  'ApprovalStatus',
  'ValidationStatus',
  'PaymentTerms',
  'PaymentMethod',
  'PurchaseOrderNumber',
  'Description',
  'CreationDate',
  'LastUpdateDate',
] as const

export const ORACLE_FUSION_INVOICE_LINE_FIELDS = [
  'LineNumber',
  'LineType',
  'LineAmount',
  'BaseAmount',
  'Description',
  'Quantity',
  'UOM',
  'UnitPrice',
  'AccountingDate',
  'ApprovalStatus',
  'DiscardedFlag',
  'CanceledFlag',
  'TrackAsAssetFlag',
  'PurchaseOrderNumber',
  'PurchaseOrderLineNumber',
  'ReceiptNumber',
  'ReceiptLineNumber',
  'Item',
  'ItemDescription',
  'TaxClassification',
  'TaxRateCode',
  'ShipToLocation',
  'CreationDate',
  'LastUpdateDate',
] as const

export const ORACLE_FUSION_INSTALLMENT_FIELDS = [
  'InstallmentNumber',
  'DueDate',
  'GrossAmount',
  'UnpaidAmount',
  'PaymentMethod',
  'PaymentPriority',
  'HoldFlag',
  'HoldReason',
  'FirstDiscountDate',
  'FirstDiscountAmount',
  'SecondDiscountDate',
  'SecondDiscountAmount',
  'ThirdDiscountDate',
  'ThirdDiscountAmount',
  'CreationDate',
  'LastUpdateDate',
] as const

export const ORACLE_FUSION_INVOICE_DISTRIBUTION_FIELDS = [
  'InvoiceDistributionId',
  'DistributionLineNumber',
  'DistributionLineType',
  'DistributionAmount',
  'BaseAmount',
  'Description',
  'AccountingDate',
  'AccountingStatus',
  'DistributionCombination',
  'MatchedStatus',
  'FundsStatus',
  'CanceledFlag',
  'ReversedFlag',
  'PurchaseOrderNumber',
  'PurchaseOrderLineNumber',
  'PurchaseOrderScheduleLineNumber',
  'PurchaseOrderDistributionLineNumber',
  'ReceiptNumber',
  'ReceiptLineNumber',
  'PrepaymentNumber',
  'PrepaymentLineNumber',
  'TaxName',
  'TaxRate',
  'AssetBook',
  'TrackAsAssetFlag',
  'CreationDate',
  'LastUpdateDate',
] as const

export const ORACLE_FUSION_APPLIED_PREPAYMENT_FIELDS = [
  'InvoiceNumber',
  'LineNumber',
  'Description',
  'SupplierSite',
  'PurchaseOrder',
  'Currency',
  'AppliedAmount',
  'IncludedTax',
  'IncludedonInvoiceFlag',
  'ApplicationAccountingDate',
] as const

export const ORACLE_FUSION_AVAILABLE_PREPAYMENT_FIELDS = [
  'InvoiceNumber',
  'LineNumber',
  'Description',
  'SupplierSite',
  'PurchaseOrder',
  'Currency',
  'AvailableAmount',
  'IncludedTax',
] as const

export const ORACLE_FUSION_PAYMENT_FIELDS = [
  'CheckId',
  'PaymentId',
  'PaymentReference',
  'PaymentNumber',
  'PaymentAmount',
  'PaymentCurrency',
  'PaymentDate',
  'AccountingDate',
  'Payee',
  'PayeeSite',
  'SupplierNumber',
  'PaymentMethod',
  'PaymentStatus',
  'PaymentType',
  'BusinessUnit',
  'LegalEntity',
  'ReconciledFlag',
  'CreationDate',
  'LastUpdateDate',
] as const

export const ORACLE_FUSION_PAYMENT_RELATED_INVOICE_FIELDS = [
  'InvoicePaymentId',
  'CheckId',
  'InvoiceId',
  'InvoiceBusinessUnit',
  'InvoiceNumber',
  'InstallmentNumber',
  'AmountPaidPaymentCurrency',
  'AmountPaidInvoiceCurrency',
  'InvoiceAmount',
  'InvoicePaymentAmount',
  'InvoicePaymentStatus',
  'DiscountLost',
  'DiscountTaken',
  'InvoiceBaseAmount',
  'PaymentBaseAmount',
  'InvoiceCurrency',
  'CrossCurrencyRate',
  'CreationDate',
  'LastUpdateDate',
] as const

export const ORACLE_FUSION_INVOICE_HOLD_FIELDS = [
  'HoldId',
  'InvoiceNumber',
  'BusinessUnit',
  'Supplier',
  'Party',
  'LineHeld',
  'HoldName',
  'HoldReason',
  'HoldDetails',
  'HeldBy',
  'HoldDate',
  'ReleaseName',
  'ReleaseReason',
  'ReleaseDate',
  'WorkflowStatus',
  'PurchaseOrderNumber',
  'PurchaseOrderLineNumber',
  'PurchaseOrderScheduleLineNumber',
  'ReceiptNumber',
  'ReceiptLineNumber',
  'CreationDate',
  'LastUpdateDate',
] as const

export const ORACLE_FUSION_PAYMENT_PROCESS_REQUEST_FIELDS = [
  'PaymentProcessRequestId',
  'PaymentProcessRequestName',
  'SourceApplicationIdentifier',
  'PaymentProcessRequestStatusCode',
  'PaymentProcessRequestStatusMeaning',
] as const

export const ORACLE_FUSION_PAYMENT_TERM_FIELDS = [
  'termsId',
  'name',
  'description',
  'enabledFlag',
  'fromDate',
  'toDate',
  'cutoffDay',
  'rank',
  'setId',
  'creationDate',
  'lastUpdateDate',
] as const

export const ORACLE_FUSION_PAYMENT_TERM_LINE_FIELDS = [
  'termsId',
  'sequenceNumber',
  'amountDue',
  'calendar',
  'dayOfMonth',
  'days',
  'duePercent',
  'fixedDate',
  'monthsAhead',
  'firstDiscountDayOfMonth',
  'firstDiscountDays',
  'firstDiscountMonthsForward',
  'firstDiscountPercent',
  'secondDiscountDayOfMonth',
  'secondDiscountDays',
  'secondDiscountMonthsForward',
  'secondDiscountPercent',
  'thirdDiscountDayOfMonth',
  'thirdDiscountDays',
  'thirdDiscountMonthsForward',
  'thirdDiscountPercent',
] as const

const oracleText = z.string().nullable().optional()
const oracleNumber = z.number().finite().nullable().optional()
const oracleInteger = z.number().int().finite().nullable().optional()
const oracleBoolean = z.boolean().nullable().optional()
const oracleNonNullableText = z.string().optional()
const oracleNonNullableNumber = z.number().finite().optional()
const oracleNonNullableInteger = z.number().int().finite().optional()
const oracleNonNullableBoolean = z.boolean().optional()
/** Framework v9 encodes high-precision identifiers as strings; earlier/small values can be numbers. */
const decimalIdentifier = z.unknown().transform((value, context) => {
  const normalized = normalizeOracleFusionDecimalIdentifier(value, { maxDigits: 64 })
  if (normalized !== undefined) return normalized
  context.addIssue({
    code: 'custom',
    message: 'Oracle identifier must be an exact decimal integer',
  })
  return z.NEVER
})
const oracleDecimalString = decimalIdentifier.nullable().optional()
const oracleNonNullableDecimalString = decimalIdentifier.optional()

/** These non-ID int64 fields also have precision 18 in Oracle's schema and become strings in v9. */
const exactInteger = z.unknown().transform((value, context) => {
  const negative =
    (typeof value === 'number' && value < 0) || (typeof value === 'string' && value.startsWith('-'))
  const magnitude =
    typeof value === 'number'
      ? Math.abs(value)
      : typeof value === 'string' && negative
        ? value.slice(1)
        : value
  const normalized = normalizeOracleFusionDecimalIdentifier(magnitude, { maxDigits: 18 })
  if (normalized !== undefined) {
    return negative && normalized !== '0' ? `-${normalized}` : normalized
  }
  context.addIssue({ code: 'custom', message: 'Oracle value must be an exact 18-digit integer' })
  return z.NEVER
})
const oracleExactIntegerString = exactInteger.nullable().optional()
const oracleNonNullableExactIntegerString = exactInteger.optional()

export const oracleFusionInvoiceSchema = z
  .object({
    InvoiceId: oracleNonNullableDecimalString,
    InvoiceNumber: oracleNonNullableText,
    Supplier: oracleText,
    SupplierNumber: oracleNonNullableText,
    SupplierSite: oracleText,
    BusinessUnit: oracleNonNullableText,
    InvoiceAmount: oracleNonNullableNumber,
    InvoiceCurrency: oracleNonNullableText,
    InvoiceDate: oracleNonNullableText,
    AccountingDate: oracleNonNullableText,
    AmountPaid: oracleNumber,
    PaidStatus: oracleNonNullableText,
    ApprovalStatus: oracleNonNullableText,
    ValidationStatus: oracleText,
    PaymentTerms: oracleNonNullableText,
    PaymentMethod: oracleNonNullableText,
    PurchaseOrderNumber: oracleText,
    Description: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionInvoiceLineSchema = z
  .object({
    LineNumber: oracleNonNullableExactIntegerString,
    LineType: oracleText,
    LineAmount: oracleNumber,
    BaseAmount: oracleNumber,
    Description: oracleText,
    Quantity: oracleNumber,
    UOM: oracleText,
    UnitPrice: oracleNumber,
    AccountingDate: oracleNonNullableText,
    ApprovalStatus: oracleNonNullableText,
    DiscardedFlag: oracleBoolean,
    CanceledFlag: oracleBoolean,
    TrackAsAssetFlag: oracleBoolean,
    PurchaseOrderNumber: oracleText,
    PurchaseOrderLineNumber: oracleNumber,
    ReceiptNumber: oracleText,
    ReceiptLineNumber: oracleExactIntegerString,
    Item: oracleText,
    ItemDescription: oracleText,
    TaxClassification: oracleText,
    TaxRateCode: oracleText,
    ShipToLocation: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionInstallmentSchema = z
  .object({
    InstallmentNumber: oracleNonNullableExactIntegerString,
    DueDate: oracleNonNullableText,
    GrossAmount: oracleNonNullableNumber,
    UnpaidAmount: oracleNumber,
    PaymentMethod: oracleNonNullableText,
    PaymentPriority: oracleNonNullableInteger,
    HoldFlag: oracleBoolean,
    HoldReason: oracleText,
    FirstDiscountDate: oracleText,
    FirstDiscountAmount: oracleNumber,
    SecondDiscountDate: oracleText,
    SecondDiscountAmount: oracleNumber,
    ThirdDiscountDate: oracleText,
    ThirdDiscountAmount: oracleNumber,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionInvoiceDistributionSchema = z
  .object({
    InvoiceDistributionId: oracleNonNullableDecimalString,
    DistributionLineNumber: oracleNonNullableInteger,
    DistributionLineType: oracleText,
    DistributionAmount: oracleNonNullableNumber,
    BaseAmount: oracleNumber,
    Description: oracleText,
    AccountingDate: oracleNonNullableText,
    AccountingStatus: oracleNonNullableText,
    DistributionCombination: oracleText,
    MatchedStatus: oracleNonNullableText,
    FundsStatus: oracleNonNullableText,
    CanceledFlag: oracleBoolean,
    ReversedFlag: oracleBoolean,
    PurchaseOrderNumber: oracleNonNullableText,
    PurchaseOrderLineNumber: oracleNonNullableNumber,
    PurchaseOrderScheduleLineNumber: oracleNonNullableNumber,
    PurchaseOrderDistributionLineNumber: oracleNonNullableNumber,
    ReceiptNumber: oracleText,
    ReceiptLineNumber: oracleNonNullableExactIntegerString,
    PrepaymentNumber: oracleText,
    PrepaymentLineNumber: oracleText,
    TaxName: oracleText,
    TaxRate: oracleText,
    AssetBook: oracleText,
    TrackAsAssetFlag: oracleNonNullableBoolean,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionAppliedPrepaymentSchema = z
  .object({
    InvoiceNumber: oracleNonNullableText,
    LineNumber: oracleInteger,
    Description: oracleText,
    SupplierSite: oracleNonNullableText,
    PurchaseOrder: oracleText,
    Currency: oracleNonNullableText,
    AppliedAmount: oracleNumber,
    IncludedTax: oracleNumber,
    IncludedonInvoiceFlag: oracleBoolean,
    ApplicationAccountingDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionAvailablePrepaymentSchema = z
  .object({
    InvoiceNumber: oracleNonNullableText,
    LineNumber: oracleNonNullableExactIntegerString,
    Description: oracleText,
    SupplierSite: oracleNonNullableText,
    PurchaseOrder: oracleText,
    Currency: oracleNonNullableText,
    AvailableAmount: oracleNumber,
    IncludedTax: oracleNumber,
  })
  .passthrough()

export const oracleFusionPaymentSchema = z
  .object({
    CheckId: oracleNonNullableDecimalString,
    PaymentId: oracleDecimalString,
    PaymentReference: oracleDecimalString,
    PaymentNumber: oracleNonNullableDecimalString,
    PaymentAmount: oracleNonNullableNumber,
    PaymentCurrency: oracleNonNullableText,
    PaymentDate: oracleNonNullableText,
    AccountingDate: oracleText,
    Payee: oracleText,
    PayeeSite: oracleText,
    SupplierNumber: oracleNonNullableText,
    PaymentMethod: oracleNonNullableText,
    PaymentStatus: oracleNonNullableText,
    PaymentType: oracleText,
    BusinessUnit: oracleNonNullableText,
    LegalEntity: oracleNonNullableText,
    ReconciledFlag: oracleBoolean,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionPaymentRelatedInvoiceSchema = z
  .object({
    InvoicePaymentId: oracleNonNullableDecimalString,
    CheckId: oracleNonNullableDecimalString,
    InvoiceId: oracleNonNullableDecimalString,
    InvoiceBusinessUnit: oracleText,
    InvoiceNumber: oracleNonNullableText,
    InstallmentNumber: oracleNonNullableExactIntegerString,
    AmountPaidPaymentCurrency: oracleNonNullableNumber,
    AmountPaidInvoiceCurrency: oracleNumber,
    InvoiceAmount: oracleNumber,
    InvoicePaymentAmount: oracleNumber,
    InvoicePaymentStatus: oracleText,
    DiscountLost: oracleNumber,
    DiscountTaken: oracleNumber,
    InvoiceBaseAmount: oracleNumber,
    PaymentBaseAmount: oracleNumber,
    InvoiceCurrency: oracleText,
    CrossCurrencyRate: oracleNumber,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionInvoiceHoldSchema = z
  .object({
    HoldId: oracleNonNullableDecimalString,
    InvoiceNumber: oracleText,
    BusinessUnit: oracleText,
    Supplier: oracleText,
    Party: oracleText,
    LineHeld: oracleNumber,
    HoldName: oracleText,
    HoldReason: oracleText,
    HoldDetails: oracleText,
    HeldBy: oracleText,
    HoldDate: oracleNonNullableText,
    ReleaseName: oracleText,
    ReleaseReason: oracleText,
    ReleaseDate: oracleText,
    WorkflowStatus: oracleNonNullableText,
    PurchaseOrderNumber: oracleNonNullableText,
    PurchaseOrderLineNumber: oracleNonNullableNumber,
    PurchaseOrderScheduleLineNumber: oracleNonNullableNumber,
    ReceiptNumber: oracleText,
    ReceiptLineNumber: oracleNonNullableExactIntegerString,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionPaymentProcessRequestSchema = z
  .object({
    PaymentProcessRequestId: oracleNonNullableDecimalString,
    PaymentProcessRequestName: oracleNonNullableText,
    SourceApplicationIdentifier: oracleNonNullableDecimalString,
    PaymentProcessRequestStatusCode: oracleNonNullableText,
    PaymentProcessRequestStatusMeaning: oracleText,
  })
  .passthrough()

export const oracleFusionPaymentTermSchema = z
  .object({
    termsId: oracleNonNullableDecimalString,
    name: oracleNonNullableText,
    description: oracleText,
    enabledFlag: oracleNonNullableBoolean,
    fromDate: oracleNonNullableText,
    toDate: oracleText,
    cutoffDay: oracleInteger,
    rank: oracleExactIntegerString,
    setId: oracleNonNullableDecimalString,
    creationDate: oracleNonNullableText,
    lastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionPaymentTermLineSchema = z
  .object({
    termsId: oracleNonNullableDecimalString,
    sequenceNumber: oracleNonNullableInteger,
    amountDue: oracleNumber,
    calendar: oracleText,
    dayOfMonth: oracleInteger,
    days: oracleInteger,
    duePercent: oracleNumber,
    fixedDate: oracleText,
    monthsAhead: oracleInteger,
    firstDiscountDayOfMonth: oracleInteger,
    firstDiscountDays: oracleInteger,
    firstDiscountMonthsForward: oracleInteger,
    firstDiscountPercent: oracleNumber,
    secondDiscountDayOfMonth: oracleInteger,
    secondDiscountDays: oracleInteger,
    secondDiscountMonthsForward: oracleInteger,
    secondDiscountPercent: oracleNumber,
    thirdDiscountDayOfMonth: oracleInteger,
    thirdDiscountDays: oracleInteger,
    thirdDiscountMonthsForward: oracleInteger,
    thirdDiscountPercent: oracleNumber,
  })
  .passthrough()

const optionalBoundedExpression = z
  .string()
  .trim()
  .min(1)
  .max(8_000)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Expression contains control characters')
  .optional()

const authShape = {
  oauthCredential: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  instanceUrl: z
    .string()
    .trim()
    .refine((value) => normalizeOracleFusionApplicationOrigin(value)),
}

const listShape = {
  q: optionalBoundedExpression,
  finder: optionalBoundedExpression,
  orderBy: optionalBoundedExpression,
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().nonnegative().default(0),
  totalResults: z.boolean().default(false),
}

const opaqueKeySchema = z.string().refine((value) => {
  try {
    encodeOracleFusionPathSegment(value)
    return true
  } catch {
    return false
  }
}, 'Oracle opaque key must be one URL path segment')

const decimalIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,64}$/, 'Oracle identifier must be a decimal string')

export const oracleFusionListInvoicesInputSchema = z.object({
  ...authShape,
  ...listShape,
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveDate must use YYYY-MM-DD')
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`)
      return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    }, 'effectiveDate must be a real calendar date')
    .optional(),
})

export const oracleFusionListInputSchema = z.object({ ...authShape, ...listShape })

export const oracleFusionGetInvoiceInputSchema = z.object({
  ...authShape,
  invoiceUniqId: opaqueKeySchema,
})

export const oracleFusionInvoiceChildListInputSchema = z.object({
  ...authShape,
  ...listShape,
  invoiceUniqId: opaqueKeySchema,
})

export const oracleFusionGetInvoiceLineInputSchema = z.object({
  ...authShape,
  invoiceUniqId: opaqueKeySchema,
  invoiceLineUniqId: opaqueKeySchema,
})

export const oracleFusionGetInvoiceInstallmentInputSchema = z.object({
  ...authShape,
  invoiceUniqId: opaqueKeySchema,
  invoiceInstallmentUniqId: opaqueKeySchema,
})

export const oracleFusionInvoiceDistributionListInputSchema = z.object({
  ...authShape,
  ...listShape,
  invoiceUniqId: opaqueKeySchema,
  invoiceLineUniqId: opaqueKeySchema,
})

export const oracleFusionGetInvoiceDistributionInputSchema = z.object({
  ...authShape,
  invoiceUniqId: opaqueKeySchema,
  invoiceLineUniqId: opaqueKeySchema,
  invoiceDistributionId: decimalIdSchema,
})

export const oracleFusionGetAppliedPrepaymentInputSchema = z.object({
  ...authShape,
  invoiceUniqId: opaqueKeySchema,
  appliedPrepaymentUniqId: opaqueKeySchema,
})

export const oracleFusionGetAvailablePrepaymentInputSchema = z.object({
  ...authShape,
  invoiceUniqId: opaqueKeySchema,
  availablePrepaymentUniqId: opaqueKeySchema,
})

export const oracleFusionGetPaymentInputSchema = z.object({
  ...authShape,
  checkId: decimalIdSchema,
})

export const oracleFusionPaymentRelatedInvoiceListInputSchema = z.object({
  ...authShape,
  ...listShape,
  checkId: decimalIdSchema,
})

export const oracleFusionGetPaymentRelatedInvoiceInputSchema = z.object({
  ...authShape,
  checkId: decimalIdSchema,
  invoicePaymentId: decimalIdSchema,
})

export const oracleFusionGetInvoiceHoldInputSchema = z.object({
  ...authShape,
  holdId: decimalIdSchema,
})

export const oracleFusionGetPaymentProcessRequestInputSchema = z.object({
  ...authShape,
  paymentProcessRequestId: decimalIdSchema,
})

export const oracleFusionGetPaymentTermInputSchema = z.object({
  ...authShape,
  termsId: decimalIdSchema,
})

export const oracleFusionPaymentTermLineListInputSchema = z.object({
  ...authShape,
  ...listShape,
  termsId: decimalIdSchema,
})

export const oracleFusionGetPaymentTermLineInputSchema = z.object({
  ...authShape,
  termsId: decimalIdSchema,
  paymentTermLineUniqId: opaqueKeySchema,
})

export type OracleFusionAuthInput = z.output<typeof oracleFusionListInputSchema>

export function projectFields(
  value: Record<string, unknown>,
  fields: readonly string[]
): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  for (const field of fields) {
    if (value[field] !== undefined) projected[field] = value[field]
  }
  return projected
}
