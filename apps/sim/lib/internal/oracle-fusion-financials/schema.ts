import { z } from 'zod'
import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'
import { oracleFusionExactInteger } from '@/lib/internal/oracle-fusion/request-body'

export const oracleFusionFinancialsActionResultSchema = z.object({ result: z.string() })

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

const financialsDateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  }, 'Date must be a real calendar date')

const financialsExactIntegerInput = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,17})(?![\s\S])/,
    'Identifier must be a canonical decimal string of at most 18 digits'
  )

const oracleFusionReceivablesInvoiceLineCreateFieldsSchema = z
  .object({
    LineNumber: z.number().finite().nullable().optional(),
    Description: z.string().max(240).nullable().optional(),
    ItemNumber: z.string().max(300).nullable().optional(),
    MemoLine: z.string().max(50).nullable().optional(),
    LineAmount: z.number().finite().nullable().optional(),
    Quantity: z.number().finite().nullable().optional(),
    UnitSellingPrice: z.number().finite().nullable().optional(),
    UnitOfMeasure: z.string().max(25).nullable().optional(),
    AccountingRule: z.string().max(30).nullable().optional(),
    AccountingRuleDuration: financialsExactIntegerInput
      .transform(oracleFusionExactInteger)
      .nullable()
      .optional(),
    RuleStartDate: financialsDateInput.nullable().optional(),
    RuleEndDate: financialsDateInput.nullable().optional(),
    TaxClassificationCode: z.string().max(30).nullable().optional(),
    SalesOrder: z.string().max(50).nullable().optional(),
  })
  .strict()

const oracleFusionReceivablesInvoiceDistributionCreateFieldsSchema = z
  .object({
    AccountClass: z.string().max(80).nullable().optional(),
    AccountCombination: z.string().max(8000).nullable().optional(),
    AccountedAmount: z.number().finite().nullable().optional(),
    Amount: z.number().finite().nullable().optional(),
    InvoiceLineNumber: z.number().int().safe().nullable().optional(),
    DetailedTaxLineNumber: z.number().int().safe().nullable().optional(),
    Percent: z.number().finite().nullable().optional(),
    Comments: z.string().max(240).nullable().optional(),
  })
  .strict()

const oracleFusionReceivablesCreditMemoLineCreateFieldsSchema = z
  .object({
    LineNumber: z.number().finite(),
    LineDescription: z.string().max(240).nullable().optional(),
    ItemNumber: z.string().max(300).nullable().optional(),
    MemoLine: z.string().max(50).nullable().optional(),
    LineAmountCredit: z.number().finite().nullable().optional(),
    LineQuantityCredit: z.number().finite().nullable().optional(),
    UnitSellingPrice: z.number().finite().nullable().optional(),
    UnitOfMeasure: z.string().max(25).nullable().optional(),
    LineCreditReason: z.string().max(255).nullable().optional(),
    LineFreightCreditAmount: z.number().finite().nullable().optional(),
    TaxClassificationCode: z.string().max(30).nullable().optional(),
  })
  .strict()

const oracleFusionReceivablesCreditMemoDistributionCreateFieldsSchema = z
  .object({
    AccountClass: z.string().max(255).nullable().optional(),
    AccountCombination: z.string().max(255).nullable().optional(),
    AccountedAmount: z.number().finite().nullable().optional(),
    Amount: z.number().finite().nullable().optional(),
    CreditMemoLineNumber: z.number().int().safe().nullable().optional(),
    DetailedTaxLineNumber: z.number().int().safe().nullable().optional(),
    Percent: z.number().finite().nullable().optional(),
    Comments: z.string().max(240).nullable().optional(),
  })
  .strict()

export const ORACLE_FUSION_RECEIVABLES_INVOICE_FIELDS = [
  'CustomerTransactionId',
  'TransactionNumber',
  'BillToCustomerName',
  'BillToCustomerNumber',
  'BillToSite',
  'BusinessUnit',
  'TransactionDate',
  'AccountingDate',
  'DueDate',
  'InvoiceCurrencyCode',
  'EnteredAmount',
  'InvoiceBalanceAmount',
  'InvoiceStatus',
  'PaymentTerms',
  'TransactionSource',
  'TransactionType',
  'Comments',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionReceivablesInvoiceSchema = z
  .object({
    CustomerTransactionId: oracleNonNullableDecimalString,
    TransactionNumber: oracleText,
    BillToCustomerName: oracleText,
    BillToCustomerNumber: oracleText,
    BillToSite: oracleText,
    BusinessUnit: oracleText,
    TransactionDate: oracleText,
    AccountingDate: oracleText,
    DueDate: oracleText,
    InvoiceCurrencyCode: oracleText,
    EnteredAmount: oracleNumber,
    InvoiceBalanceAmount: oracleNumber,
    InvoiceStatus: oracleText,
    PaymentTerms: oracleText,
    TransactionSource: oracleText,
    TransactionType: oracleText,
    Comments: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListReceivablesInvoicesInputSchema = z.object({
  ...authShape,
  ...listShape,
})

export const oracleFusionGetReceivablesInvoiceInputSchema = z.object({
  ...authShape,
  receivablesInvoiceId: financialsExactIntegerInput,
})

export const oracleFusionCreateReceivablesInvoiceInputSchema = z.object({
  ...authShape,
  lines: z
    .array(z.lazy(() => oracleFusionReceivablesInvoiceLineCreateFieldsSchema))
    .min(1)
    .max(1000)
    .optional(),
  distributions: z
    .array(z.lazy(() => oracleFusionReceivablesInvoiceDistributionCreateFieldsSchema))
    .min(1)
    .max(1000)
    .optional(),
  businessUnit: z.string().max(240).nullable().optional(),
  transactionNumber: z.string().max(20).nullable().optional(),
  transactionDate: financialsDateInput.nullable().optional(),
  accountingDate: financialsDateInput.nullable().optional(),
  billToCustomerName: z.string().max(360).nullable().optional(),
  billToCustomerNumber: z.string().max(30).nullable().optional(),
  billToSite: z.string().max(150).nullable().optional(),
  invoiceCurrencyCode: z.string().max(15).nullable().optional(),
  invoiceStatus: z.literal('Complete').nullable().optional(),
  paymentTerms: z.string().max(15).nullable().optional(),
  transactionSource: z.string().max(50).nullable().optional(),
  transactionType: z.string().max(20).nullable().optional(),
  comments: z.string().max(1760).nullable().optional(),
  purchaseOrder: z.string().max(50).nullable().optional(),
  conversionRateType: z.string().max(30).nullable().optional(),
  conversionRate: z.number().finite().nullable().optional(),
  conversionDate: financialsDateInput.nullable().optional(),
})

export const oracleFusionUpdateReceivablesInvoiceInputSchema = z
  .object({
    ...authShape,
    receivablesInvoiceId: financialsExactIntegerInput,
    invoiceStatus: z.enum(['Complete', 'Incomplete', 'Frozen']).nullable().optional(),
    paymentTerms: z.string().max(15).nullable().optional(),
    transactionDate: financialsDateInput.nullable().optional(),
  })
  .refine(
    (input) =>
      [input.invoiceStatus, input.paymentTerms, input.transactionDate].some(
        (value) => value !== undefined
      ),
    'At least one writable field is required'
  )

export const oracleFusionDeleteReceivablesInvoiceInputSchema = z.object({
  ...authShape,
  receivablesInvoiceId: financialsExactIntegerInput,
})

export const oracleFusionApproveReceivablesInvoiceInputSchema = z.object({
  ...authShape,
  receivablesInvoiceId: financialsExactIntegerInput,
  comment: z.string().max(8000).optional(),
})

export const oracleFusionReworkReceivablesInvoiceInputSchema = z.object({
  ...authShape,
  receivablesInvoiceId: financialsExactIntegerInput,
  comment: z.string().max(8000).optional(),
})

export const ORACLE_FUSION_RECEIVABLES_INVOICE_LINE_FIELDS = [
  'CustomerTransactionLineId',
  'LineNumber',
  'Description',
  'ItemNumber',
  'MemoLine',
  'LineAmount',
  'Quantity',
  'UnitSellingPrice',
  'UnitOfMeasure',
  'AccountingRule',
  'AccountingRuleDuration',
  'RuleStartDate',
  'RuleEndDate',
  'TaxClassificationCode',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionReceivablesInvoiceLineSchema = z
  .object({
    CustomerTransactionLineId: oracleNonNullableDecimalString,
    LineNumber: oracleNumber,
    Description: oracleText,
    ItemNumber: oracleText,
    MemoLine: oracleText,
    LineAmount: oracleNumber,
    Quantity: oracleNumber,
    UnitSellingPrice: oracleNumber,
    UnitOfMeasure: oracleText,
    AccountingRule: oracleText,
    AccountingRuleDuration: oracleExactIntegerString,
    RuleStartDate: oracleText,
    RuleEndDate: oracleText,
    TaxClassificationCode: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListReceivablesInvoiceLinesInputSchema = z.object({
  ...authShape,
  ...listShape,
  receivablesInvoiceId: financialsExactIntegerInput,
})

export const oracleFusionGetReceivablesInvoiceLineInputSchema = z.object({
  ...authShape,
  receivablesInvoiceId: financialsExactIntegerInput,
  receivablesInvoiceLineId: financialsExactIntegerInput,
})

export const oracleFusionCreateReceivablesInvoiceLineInputSchema = z.object({
  ...authShape,
  receivablesInvoiceId: financialsExactIntegerInput,
  lineNumber: z.number().finite().nullable().optional(),
  description: z.string().max(240).nullable().optional(),
  itemNumber: z.string().max(300).nullable().optional(),
  memoLine: z.string().max(50).nullable().optional(),
  lineAmount: z.number().finite().nullable().optional(),
  quantity: z.number().finite().nullable().optional(),
  unitSellingPrice: z.number().finite().nullable().optional(),
  unitOfMeasure: z.string().max(25).nullable().optional(),
  accountingRule: z.string().max(30).nullable().optional(),
  accountingRuleDuration: financialsExactIntegerInput
    .transform(oracleFusionExactInteger)
    .nullable()
    .optional(),
  ruleStartDate: financialsDateInput.nullable().optional(),
  ruleEndDate: financialsDateInput.nullable().optional(),
  taxClassificationCode: z.string().max(30).nullable().optional(),
  salesOrder: z.string().max(50).nullable().optional(),
})

export const ORACLE_FUSION_RECEIVABLES_INVOICE_DISTRIBUTION_FIELDS = [
  'DistributionId',
  'AccountClass',
  'AccountCombination',
  'AccountedAmount',
  'Amount',
  'InvoiceLineNumber',
  'DetailedTaxLineNumber',
  'Percent',
  'Comments',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionReceivablesInvoiceDistributionSchema = z
  .object({
    DistributionId: oracleNonNullableDecimalString,
    AccountClass: oracleText,
    AccountCombination: oracleText,
    AccountedAmount: oracleNumber,
    Amount: oracleNumber,
    InvoiceLineNumber: oracleInteger,
    DetailedTaxLineNumber: oracleInteger,
    Percent: oracleNumber,
    Comments: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListReceivablesInvoiceDistributionsInputSchema = z.object({
  ...authShape,
  ...listShape,
  receivablesInvoiceId: financialsExactIntegerInput,
})

export const oracleFusionGetReceivablesInvoiceDistributionInputSchema = z.object({
  ...authShape,
  receivablesInvoiceId: financialsExactIntegerInput,
  receivablesInvoiceDistributionId: financialsExactIntegerInput,
})

export const oracleFusionCreateReceivablesInvoiceDistributionInputSchema = z.object({
  ...authShape,
  receivablesInvoiceId: financialsExactIntegerInput,
  accountClass: z.string().max(80).nullable().optional(),
  accountCombination: z.string().max(8000).nullable().optional(),
  accountedAmount: z.number().finite().nullable().optional(),
  amount: z.number().finite().nullable().optional(),
  invoiceLineNumber: z.number().int().safe().nullable().optional(),
  detailedTaxLineNumber: z.number().int().safe().nullable().optional(),
  percent: z.number().finite().nullable().optional(),
  comments: z.string().max(240).nullable().optional(),
})

export const ORACLE_FUSION_RECEIVABLES_INVOICE_INSTALLMENT_FIELDS = [
  'InstallmentId',
  'InstallmentSequenceNumber',
  'InstallmentDueDate',
  'OriginalAmount',
  'InstallmentBalanceDue',
  'AccountedBalanceDue',
  'AmountPaid',
  'InstallmentAmountAdjusted',
  'InstallmentAmountCredited',
  'InstallmentStatus',
  'DisputeAmount',
  'DisputeDate',
  'PaymentDaysLate',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionReceivablesInvoiceInstallmentSchema = z
  .object({
    InstallmentId: oracleNonNullableDecimalString,
    InstallmentSequenceNumber: oracleExactIntegerString,
    InstallmentDueDate: oracleNonNullableText,
    OriginalAmount: oracleNonNullableNumber,
    InstallmentBalanceDue: oracleNonNullableNumber,
    AccountedBalanceDue: oracleNonNullableNumber,
    AmountPaid: oracleNumber,
    InstallmentAmountAdjusted: oracleNumber,
    InstallmentAmountCredited: oracleNumber,
    InstallmentStatus: oracleText,
    DisputeAmount: oracleNumber,
    DisputeDate: oracleText,
    PaymentDaysLate: oracleInteger,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListReceivablesInvoiceInstallmentsInputSchema = z.object({
  ...authShape,
  ...listShape,
  receivablesInvoiceId: financialsExactIntegerInput,
})

export const oracleFusionGetReceivablesInvoiceInstallmentInputSchema = z.object({
  ...authShape,
  receivablesInvoiceId: financialsExactIntegerInput,
  receivablesInvoiceInstallmentId: financialsExactIntegerInput,
})

export const oracleFusionUpdateReceivablesInvoiceInstallmentInputSchema = z
  .object({
    ...authShape,
    receivablesInvoiceId: financialsExactIntegerInput,
    receivablesInvoiceInstallmentId: financialsExactIntegerInput,
    installmentDueDate: financialsDateInput.optional(),
    originalAmount: z.number().finite().optional(),
  })
  .refine(
    (input) =>
      [input.installmentDueDate, input.originalAmount].some((value) => value !== undefined),
    'At least one writable field is required'
  )

export const ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_FIELDS = [
  'CustomerTransactionId',
  'TransactionNumber',
  'BusinessUnit',
  'BillToCustomerName',
  'BillToCustomerNumber',
  'BillToSite',
  'TransactionDate',
  'AccountingDate',
  'CreditMemoCurrency',
  'CreditMemoStatus',
  'CreditReason',
  'EnteredAmount',
  'TransactionBalanceDue',
  'FreightCreditAmount',
  'TransactionSource',
  'TransactionType',
  'CreditMemoComments',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionReceivablesCreditMemoSchema = z
  .object({
    CustomerTransactionId: oracleNonNullableDecimalString,
    TransactionNumber: oracleNonNullableText,
    BusinessUnit: oracleNonNullableText,
    BillToCustomerName: oracleText,
    BillToCustomerNumber: oracleText,
    BillToSite: oracleText,
    TransactionDate: oracleNonNullableText,
    AccountingDate: oracleText,
    CreditMemoCurrency: oracleText,
    CreditMemoStatus: oracleText,
    CreditReason: oracleText,
    EnteredAmount: oracleNumber,
    TransactionBalanceDue: oracleNumber,
    FreightCreditAmount: oracleText,
    TransactionSource: oracleText,
    TransactionType: oracleText,
    CreditMemoComments: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListReceivablesCreditMemosInputSchema = z.object({
  ...authShape,
  ...listShape,
})

export const oracleFusionGetReceivablesCreditMemoInputSchema = z.object({
  ...authShape,
  receivablesCreditMemoId: financialsExactIntegerInput,
})

export const oracleFusionCreateReceivablesCreditMemoInputSchema = z.object({
  ...authShape,
  lines: z
    .array(z.lazy(() => oracleFusionReceivablesCreditMemoLineCreateFieldsSchema))
    .min(1)
    .max(1000)
    .optional(),
  distributions: z
    .array(z.lazy(() => oracleFusionReceivablesCreditMemoDistributionCreateFieldsSchema))
    .min(1)
    .max(1000)
    .optional(),
  businessUnit: z.string().max(240).min(1),
  transactionNumber: z.string().max(20).min(1),
  transactionDate: financialsDateInput,
  accountingDate: financialsDateInput.nullable().optional(),
  billToCustomerName: z.string().max(255).nullable().optional(),
  billToCustomerNumber: z.string().max(30).nullable().optional(),
  billToSite: z.string().max(150).nullable().optional(),
  creditMemoCurrency: z.string().max(15).nullable().optional(),
  creditMemoStatus: z.string().max(8000).nullable().optional(),
  creditReason: z.string().max(255).nullable().optional(),
  freightCreditAmount: z.string().max(8000).nullable().optional(),
  transactionSource: z.string().max(50).nullable().optional(),
  transactionType: z.string().max(20).nullable().optional(),
  creditMemoComments: z.string().max(1760).nullable().optional(),
  conversionRate: z.number().finite().nullable().optional(),
  conversionRateType: z.string().max(30).nullable().optional(),
  conversionRateDate: financialsDateInput.nullable().optional(),
})

export const oracleFusionUpdateReceivablesCreditMemoInputSchema = z
  .object({
    ...authShape,
    receivablesCreditMemoId: financialsExactIntegerInput,
    allowCompletion: z.string().max(1).nullable().optional(),
    controlCompletionReason: z.string().max(8000).nullable().optional(),
    creditMemoStatus: z.string().max(8000).nullable().optional(),
    recipientEmail: z.string().max(1000).nullable().optional(),
    transactionType: z.string().max(20).nullable().optional(),
  })
  .refine(
    (input) =>
      [
        input.allowCompletion,
        input.controlCompletionReason,
        input.creditMemoStatus,
        input.recipientEmail,
        input.transactionType,
      ].some((value) => value !== undefined),
    'At least one writable field is required'
  )

export const oracleFusionApproveReceivablesCreditMemoInputSchema = z.object({
  ...authShape,
  receivablesCreditMemoId: financialsExactIntegerInput,
  comment: z.string().max(8000).optional(),
})

export const oracleFusionReworkReceivablesCreditMemoInputSchema = z.object({
  ...authShape,
  receivablesCreditMemoId: financialsExactIntegerInput,
  comment: z.string().max(8000).optional(),
})

export const ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_LINE_FIELDS = [
  'CustomerTransactionLineId',
  'LineNumber',
  'LineDescription',
  'ItemNumber',
  'MemoLine',
  'LineAmountCredit',
  'LineQuantityCredit',
  'UnitSellingPrice',
  'UnitOfMeasure',
  'LineCreditReason',
  'LineFreightCreditAmount',
  'TaxClassificationCode',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionReceivablesCreditMemoLineSchema = z
  .object({
    CustomerTransactionLineId: oracleNonNullableDecimalString,
    LineNumber: oracleNonNullableNumber,
    LineDescription: oracleText,
    ItemNumber: oracleText,
    MemoLine: oracleText,
    LineAmountCredit: oracleNumber,
    LineQuantityCredit: oracleNumber,
    UnitSellingPrice: oracleNumber,
    UnitOfMeasure: oracleText,
    LineCreditReason: oracleText,
    LineFreightCreditAmount: oracleNumber,
    TaxClassificationCode: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListReceivablesCreditMemoLinesInputSchema = z.object({
  ...authShape,
  ...listShape,
  receivablesCreditMemoId: financialsExactIntegerInput,
})

export const oracleFusionGetReceivablesCreditMemoLineInputSchema = z.object({
  ...authShape,
  receivablesCreditMemoId: financialsExactIntegerInput,
  receivablesCreditMemoLineId: financialsExactIntegerInput,
})

export const oracleFusionCreateReceivablesCreditMemoLineInputSchema = z.object({
  ...authShape,
  receivablesCreditMemoId: financialsExactIntegerInput,
  lineNumber: z.number().finite(),
  lineDescription: z.string().max(240).nullable().optional(),
  itemNumber: z.string().max(300).nullable().optional(),
  memoLine: z.string().max(50).nullable().optional(),
  lineAmountCredit: z.number().finite().nullable().optional(),
  lineQuantityCredit: z.number().finite().nullable().optional(),
  unitSellingPrice: z.number().finite().nullable().optional(),
  unitOfMeasure: z.string().max(25).nullable().optional(),
  lineCreditReason: z.string().max(255).nullable().optional(),
  lineFreightCreditAmount: z.number().finite().nullable().optional(),
  taxClassificationCode: z.string().max(30).nullable().optional(),
})

export const ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_DISTRIBUTION_FIELDS = [
  'DistributionId',
  'AccountClass',
  'AccountCombination',
  'AccountedAmount',
  'Amount',
  'CreditMemoLineNumber',
  'DetailedTaxLineNumber',
  'Percent',
  'Comments',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionReceivablesCreditMemoDistributionSchema = z
  .object({
    DistributionId: oracleNonNullableDecimalString,
    AccountClass: oracleText,
    AccountCombination: oracleText,
    AccountedAmount: oracleNumber,
    Amount: oracleNumber,
    CreditMemoLineNumber: oracleInteger,
    DetailedTaxLineNumber: oracleInteger,
    Percent: oracleNumber,
    Comments: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListReceivablesCreditMemoDistributionsInputSchema = z.object({
  ...authShape,
  ...listShape,
  receivablesCreditMemoId: financialsExactIntegerInput,
})

export const oracleFusionGetReceivablesCreditMemoDistributionInputSchema = z.object({
  ...authShape,
  receivablesCreditMemoId: financialsExactIntegerInput,
  receivablesCreditMemoDistributionId: financialsExactIntegerInput,
})

export const oracleFusionCreateReceivablesCreditMemoDistributionInputSchema = z.object({
  ...authShape,
  receivablesCreditMemoId: financialsExactIntegerInput,
  accountClass: z.string().max(255).nullable().optional(),
  accountCombination: z.string().max(255).nullable().optional(),
  accountedAmount: z.number().finite().nullable().optional(),
  amount: z.number().finite().nullable().optional(),
  creditMemoLineNumber: z.number().int().safe().nullable().optional(),
  detailedTaxLineNumber: z.number().int().safe().nullable().optional(),
  percent: z.number().finite().nullable().optional(),
  comments: z.string().max(240).nullable().optional(),
})

export const ORACLE_FUSION_RECEIVABLES_RECEIPT_FIELDS = [
  'StandardReceiptId',
  'ReceiptNumber',
  'Amount',
  'AccountedAmount',
  'UnappliedAmount',
  'Currency',
  'BusinessUnit',
  'ReceiptDate',
  'AccountingDate',
  'ReceiptMethod',
  'CustomerName',
  'CustomerAccountNumber',
  'CustomerSite',
  'State',
  'Status',
  'Comments',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionReceivablesReceiptSchema = z
  .object({
    StandardReceiptId: oracleNonNullableDecimalString,
    ReceiptNumber: oracleText,
    Amount: oracleNonNullableNumber,
    AccountedAmount: oracleNonNullableNumber,
    UnappliedAmount: oracleNumber,
    Currency: oracleNonNullableText,
    BusinessUnit: oracleNonNullableText,
    ReceiptDate: oracleNonNullableText,
    AccountingDate: oracleText,
    ReceiptMethod: oracleNonNullableText,
    CustomerName: oracleText,
    CustomerAccountNumber: oracleText,
    CustomerSite: oracleText,
    State: oracleText,
    Status: oracleText,
    Comments: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListReceivablesReceiptsInputSchema = z.object({
  ...authShape,
  ...listShape,
})

export const oracleFusionGetReceivablesReceiptInputSchema = z.object({
  ...authShape,
  receivablesReceiptId: financialsExactIntegerInput,
})

export const oracleFusionCreateReceivablesReceiptInputSchema = z.object({
  ...authShape,
  amount: z.number().finite(),
  businessUnit: z.string().max(240).min(1),
  currency: z.string().max(15).min(1),
  receiptDate: financialsDateInput,
  receiptMethod: z.string().max(30).min(1),
  receiptNumber: z.string().max(30).nullable().optional(),
  accountingDate: financialsDateInput.nullable().optional(),
  customerAccountNumber: z.string().max(30).nullable().optional(),
  customerName: z.string().max(360).nullable().optional(),
  customerSite: z.string().max(150).nullable().optional(),
  comments: z.string().max(2000).nullable().optional(),
  conversionRate: z.number().finite().nullable().optional(),
  conversionRateType: z.string().max(30).nullable().optional(),
  conversionDate: financialsDateInput.nullable().optional(),
  maturityDate: financialsDateInput.nullable().optional(),
  structuredPaymentReference: z.string().max(256).nullable().optional(),
})

export const oracleFusionUpdateReceivablesReceiptInputSchema = z
  .object({
    ...authShape,
    receivablesReceiptId: financialsExactIntegerInput,
    amount: z.number().finite().optional(),
    currency: z.string().max(15).optional(),
    receiptDate: financialsDateInput.optional(),
    receiptMethod: z.string().max(30).optional(),
    receiptNumber: z.string().max(30).nullable().optional(),
    accountingDate: financialsDateInput.nullable().optional(),
    customerAccountNumber: z.string().max(30).nullable().optional(),
    customerName: z.string().max(360).nullable().optional(),
    customerSite: z.string().max(150).nullable().optional(),
    comments: z.string().max(2000).nullable().optional(),
    conversionRate: z.number().finite().nullable().optional(),
    conversionRateType: z.string().max(30).nullable().optional(),
    conversionDate: financialsDateInput.nullable().optional(),
    maturityDate: financialsDateInput.nullable().optional(),
    structuredPaymentReference: z.string().max(256).nullable().optional(),
  })
  .refine(
    (input) =>
      [
        input.amount,
        input.currency,
        input.receiptDate,
        input.receiptMethod,
        input.receiptNumber,
        input.accountingDate,
        input.customerAccountNumber,
        input.customerName,
        input.customerSite,
        input.comments,
        input.conversionRate,
        input.conversionRateType,
        input.conversionDate,
        input.maturityDate,
        input.structuredPaymentReference,
      ].some((value) => value !== undefined),
    'At least one writable field is required'
  )

export const oracleFusionDeleteReceivablesReceiptInputSchema = z.object({
  ...authShape,
  receivablesReceiptId: financialsExactIntegerInput,
})

export const oracleFusionApplyReceivablesReceiptInputSchema = z.object({
  ...authShape,
  receivablesReceiptId: financialsExactIntegerInput,
  appliedPaymentScheduleId: financialsExactIntegerInput.transform(oracleFusionExactInteger),
  amountApplied: z.number().finite().positive().optional(),
  calledFrom: z.string().max(240).optional(),
})

export const ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_FIELDS = [
  'AccountId',
  'AccountNumber',
  'CustomerId',
  'CustomerName',
  'TotalOpenReceivablesForAccount',
  'TotalTransactionsDueForAccount',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionReceivablesCustomerAccountSchema = z
  .object({
    AccountId: oracleNonNullableDecimalString,
    AccountNumber: oracleNonNullableText,
    CustomerId: oracleNonNullableDecimalString,
    CustomerName: oracleNonNullableText,
    TotalOpenReceivablesForAccount: oracleNumber,
    TotalTransactionsDueForAccount: oracleNumber,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListReceivablesCustomerAccountsInputSchema = z.object({
  ...authShape,
  ...listShape,
})

export const oracleFusionGetReceivablesCustomerAccountInputSchema = z.object({
  ...authShape,
  receivablesCustomerAccountId: financialsExactIntegerInput,
})

export const ORACLE_FUSION_RECEIVABLES_CUSTOMER_ACCOUNT_SITE_FIELDS = [
  'BillToSiteUseId',
  'BillToSiteNumber',
  'BillToSiteAddress',
  'AccountId',
  'AccountNumber',
  'CustomerId',
  'CustomerName',
  'TotalOpenReceivablesForSite',
  'TotalTransactionsDueForSite',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionReceivablesCustomerAccountSiteSchema = z
  .object({
    BillToSiteUseId: oracleNonNullableDecimalString,
    BillToSiteNumber: oracleNonNullableText,
    BillToSiteAddress: oracleText,
    AccountId: oracleNonNullableDecimalString,
    AccountNumber: oracleNonNullableText,
    CustomerId: oracleNonNullableDecimalString,
    CustomerName: oracleNonNullableText,
    TotalOpenReceivablesForSite: oracleNumber,
    TotalTransactionsDueForSite: oracleNumber,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListReceivablesCustomerAccountSitesInputSchema = z.object({
  ...authShape,
  ...listShape,
})

export const oracleFusionGetReceivablesCustomerAccountSiteInputSchema = z.object({
  ...authShape,
  receivablesCustomerAccountSiteId: financialsExactIntegerInput,
})

export const ORACLE_FUSION_RECEIVABLES_RECEIPT_APPLICATION_FIELDS = [
  'ApplicationId',
  'StandardReceiptId',
  'ReceiptNumber',
  'ApplicationAmount',
  'EnteredCurrency',
  'ApplicationDate',
  'AccountingDate',
  'ApplicationStatus',
  'ProcessStatus',
  'IsLatestApplication',
  'ReferenceInstallmentId',
  'ReferenceTransactionId',
  'ReferenceTransactionNumber',
  'ReferenceTransactionStatus',
] as const

export const oracleFusionReceivablesReceiptApplicationSchema = z
  .object({
    ApplicationId: oracleNonNullableDecimalString,
    StandardReceiptId: oracleNonNullableDecimalString,
    ReceiptNumber: oracleText,
    ApplicationAmount: oracleNonNullableNumber,
    EnteredCurrency: oracleNonNullableText,
    ApplicationDate: oracleNonNullableText,
    AccountingDate: oracleNonNullableText,
    ApplicationStatus: oracleText,
    ProcessStatus: oracleText,
    IsLatestApplication: oracleNonNullableText,
    ReferenceInstallmentId: oracleDecimalString,
    ReferenceTransactionId: oracleNonNullableDecimalString,
    ReferenceTransactionNumber: oracleText,
    ReferenceTransactionStatus: oracleText,
  })
  .passthrough()

export const oracleFusionListReceivablesReceiptApplicationsInputSchema = z.object({
  ...authShape,
  ...listShape,
  receivablesCustomerAccountId: financialsExactIntegerInput,
})

export const oracleFusionGetReceivablesReceiptApplicationInputSchema = z.object({
  ...authShape,
  receivablesCustomerAccountId: financialsExactIntegerInput,
  receivablesReceiptApplicationId: financialsExactIntegerInput,
})

export const ORACLE_FUSION_RECEIVABLES_CREDIT_MEMO_APPLICATION_FIELDS = [
  'ApplicationId',
  'CreditMemoId',
  'CreditMemoNumber',
  'ApplicationAmount',
  'EnteredCurrency',
  'ApplicationDate',
  'AccountingDate',
  'ApplicationStatus',
  'CreditMemoStatus',
  'IsLatestApplication',
  'ReferenceInstallmentId',
  'ReferenceTransactionId',
  'ReferenceTransactionNumber',
  'ReferenceTransactionStatus',
] as const

export const oracleFusionReceivablesCreditMemoApplicationSchema = z
  .object({
    ApplicationId: oracleNonNullableDecimalString,
    CreditMemoId: oracleNonNullableDecimalString,
    CreditMemoNumber: oracleNonNullableText,
    ApplicationAmount: oracleNonNullableNumber,
    EnteredCurrency: oracleText,
    ApplicationDate: oracleNonNullableText,
    AccountingDate: oracleNonNullableText,
    ApplicationStatus: oracleText,
    CreditMemoStatus: oracleText,
    IsLatestApplication: oracleNonNullableText,
    ReferenceInstallmentId: oracleDecimalString,
    ReferenceTransactionId: oracleNonNullableDecimalString,
    ReferenceTransactionNumber: oracleText,
    ReferenceTransactionStatus: oracleText,
  })
  .passthrough()

export const oracleFusionListReceivablesCreditMemoApplicationsInputSchema = z.object({
  ...authShape,
  ...listShape,
  receivablesCustomerAccountId: financialsExactIntegerInput,
})

export const oracleFusionGetReceivablesCreditMemoApplicationInputSchema = z.object({
  ...authShape,
  receivablesCustomerAccountId: financialsExactIntegerInput,
  receivablesCreditMemoApplicationId: financialsExactIntegerInput,
})

export const ORACLE_FUSION_RECEIVABLES_TRANSACTION_PAYMENT_SCHEDULE_FIELDS = [
  'InstallmentId',
  'InstallmentNumber',
  'InstallmentStatus',
  'TransactionId',
  'TransactionNumber',
  'TransactionClass',
  'TransactionType',
  'TransactionSourceName',
  'TransactionDate',
  'PaymentScheduleDueDate',
  'PaymentDaysLate',
  'TotalBalanceAmount',
  'TotalOriginalAmount',
  'EnteredCurrency',
  'BillToSiteNumber',
  'PurchaseOrder',
] as const

export const oracleFusionReceivablesTransactionPaymentScheduleSchema = z
  .object({
    InstallmentId: oracleNonNullableDecimalString,
    InstallmentNumber: oracleExactIntegerString,
    InstallmentStatus: oracleText,
    TransactionId: oracleNonNullableDecimalString,
    TransactionNumber: oracleNonNullableText,
    TransactionClass: oracleText,
    TransactionType: oracleText,
    TransactionSourceName: oracleNonNullableText,
    TransactionDate: oracleNonNullableText,
    PaymentScheduleDueDate: oracleNonNullableText,
    PaymentDaysLate: oracleInteger,
    TotalBalanceAmount: oracleNonNullableNumber,
    TotalOriginalAmount: oracleNonNullableNumber,
    EnteredCurrency: oracleText,
    BillToSiteNumber: oracleNonNullableText,
    PurchaseOrder: oracleText,
  })
  .passthrough()

export const oracleFusionListReceivablesTransactionPaymentSchedulesInputSchema = z.object({
  ...authShape,
  ...listShape,
  receivablesCustomerAccountId: financialsExactIntegerInput,
})

export const oracleFusionGetReceivablesTransactionPaymentScheduleInputSchema = z.object({
  ...authShape,
  receivablesCustomerAccountId: financialsExactIntegerInput,
  receivablesTransactionPaymentScheduleId: financialsExactIntegerInput,
})

export const ORACLE_FUSION_RECEIVABLES_TRANSACTION_ADJUSTMENT_FIELDS = [
  'AdjustmentId',
  'AdjustmentNumber',
  'AdjustmentAmount',
  'AdjustmentReason',
  'AdjustmentType',
  'EnteredCurrency',
  'AccountingDate',
  'ApplicationDate',
  'ProcessStatus',
  'ReferenceInstallmentId',
  'ReferenceTransactionId',
  'ReferenceTransactionNumber',
  'ReferenceTransactionStatus',
] as const

export const oracleFusionReceivablesTransactionAdjustmentSchema = z
  .object({
    AdjustmentId: oracleNonNullableDecimalString,
    AdjustmentNumber: oracleNonNullableText,
    AdjustmentAmount: oracleNonNullableNumber,
    AdjustmentReason: oracleText,
    AdjustmentType: oracleText,
    EnteredCurrency: oracleText,
    AccountingDate: oracleNonNullableText,
    ApplicationDate: oracleText,
    ProcessStatus: oracleText,
    ReferenceInstallmentId: oracleDecimalString,
    ReferenceTransactionId: oracleNonNullableDecimalString,
    ReferenceTransactionNumber: oracleNonNullableText,
    ReferenceTransactionStatus: oracleText,
  })
  .passthrough()

export const oracleFusionListReceivablesTransactionAdjustmentsInputSchema = z.object({
  ...authShape,
  ...listShape,
  receivablesCustomerAccountId: financialsExactIntegerInput,
})

export const oracleFusionGetReceivablesTransactionAdjustmentInputSchema = z.object({
  ...authShape,
  receivablesCustomerAccountId: financialsExactIntegerInput,
  receivablesTransactionAdjustmentId: financialsExactIntegerInput,
})
const expenseItemizationParentInput = z.union([
  z.literal('-1'),
  financialsExactIntegerInput.refine((value) => value !== '0'),
])

export const ORACLE_FUSION_EXPENSE_REPORT_FIELDS = [
  'ExpenseReportId',
  'ExpenseReportNumber',
  'ExpenseReportStatus',
  'ExpenseStatusCode',
  'ExpenseReportTotal',
  'BusinessUnit',
  'OrgId',
  'AssignmentId',
  'PersonId',
  'PersonName',
  'Purpose',
  'ExpenseReportDate',
  'ReportSubmitDate',
  'ReimbursementCurrencyCode',
  'PaymentMethodCode',
  'SubmitErrors',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionExpenseReportSchema = z
  .object({
    expenseReportUniqId: z.string().optional(),
    ExpenseReportId: oracleNonNullableDecimalString,
    ExpenseReportNumber: oracleText,
    ExpenseReportStatus: oracleNonNullableText,
    ExpenseStatusCode: oracleText,
    ExpenseReportTotal: oracleNumber,
    BusinessUnit: oracleText,
    OrgId: oracleNonNullableDecimalString,
    AssignmentId: oracleDecimalString,
    PersonId: oracleDecimalString,
    PersonName: oracleText,
    Purpose: oracleText,
    ExpenseReportDate: oracleText,
    ReportSubmitDate: oracleText,
    ReimbursementCurrencyCode: oracleText,
    PaymentMethodCode: oracleText,
    SubmitErrors: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListExpenseReportsInputSchema = z.object({
  ...authShape,
  ...listShape,
})

export const oracleFusionGetExpenseReportInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
})

export const oracleFusionCreateExpenseReportInputSchema = z.object({
  ...authShape,
  orgId: financialsExactIntegerInput.transform(oracleFusionExactInteger),
  personId: financialsExactIntegerInput.transform(oracleFusionExactInteger).nullable().optional(),
  assignmentId: financialsExactIntegerInput
    .transform(oracleFusionExactInteger)
    .nullable()
    .optional(),
  preparerId: financialsExactIntegerInput.transform(oracleFusionExactInteger).nullable().optional(),
  purpose: z.string().max(240).nullable().optional(),
  expenseReportNumber: z.string().max(50).nullable().optional(),
  expenseReportDate: financialsDateInput.nullable().optional(),
  reimbursementCurrencyCode: z.string().max(15).nullable().optional(),
  exchangeRateType: z.string().max(30).nullable().optional(),
  paymentMethodCode: z.string().max(120).nullable().optional(),
  overrideApproverId: financialsExactIntegerInput
    .transform(oracleFusionExactInteger)
    .nullable()
    .optional(),
  unappliedAdvancesJust: z.string().max(240).nullable().optional(),
  unappliedCashAdvReason: z.string().max(240).nullable().optional(),
})

export const oracleFusionUpdateExpenseReportInputSchema = z
  .object({
    ...authShape,
    expenseReportUniqId: opaqueKeySchema,
    orgId: financialsExactIntegerInput.transform(oracleFusionExactInteger).optional(),
    purpose: z.string().max(240).nullable().optional(),
    expenseReportDate: financialsDateInput.nullable().optional(),
    reimbursementCurrencyCode: z.string().max(15).nullable().optional(),
    exchangeRateType: z.string().max(30).nullable().optional(),
    paymentMethodCode: z.string().max(120).nullable().optional(),
    overrideApproverId: financialsExactIntegerInput
      .transform(oracleFusionExactInteger)
      .nullable()
      .optional(),
    unappliedAdvancesJust: z.string().max(240).nullable().optional(),
    unappliedCashAdvReason: z.string().max(240).nullable().optional(),
  })
  .refine(
    (input) =>
      [
        input.orgId,
        input.purpose,
        input.expenseReportDate,
        input.reimbursementCurrencyCode,
        input.exchangeRateType,
        input.paymentMethodCode,
        input.overrideApproverId,
        input.unappliedAdvancesJust,
        input.unappliedCashAdvReason,
      ].some((value) => value !== undefined),
    'Provide at least one supported update attribute'
  )

export const oracleFusionSubmitExpenseReportInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
})

export const oracleFusionRemoveExpenseReportCashAdvanceInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
  cashAdvanceNumber: z.string().min(1).max(8000),
})

export const ORACLE_FUSION_EXPENSE_LINE_FIELDS = [
  'ExpenseId',
  'ExpenseReportId',
  'ExpenseReference',
  'ExpenseType',
  'ExpenseTypeId',
  'ExpenseTemplate',
  'ExpenseTemplateId',
  'BusinessUnit',
  'OrgId',
  'AssignmentId',
  'PersonId',
  'PersonName',
  'Description',
  'Justification',
  'ReceiptAmount',
  'ReceiptCurrencyCode',
  'ReceiptDate',
  'ReimbursableAmount',
  'ReimbursementCurrencyCode',
  'MerchantName',
  'StartDate',
  'EndDate',
  'ItemizationParentExpenseId',
  'ReceiptMissingFlag',
  'ImageReceiptRequiredFlag',
  'ValidationErrorFlag',
  'ValidationErrorMessages',
  'ValidationWarningMessages',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionExpenseLineSchema = z
  .object({
    expenseLineUniqId: z.string().optional(),
    ExpenseId: oracleNonNullableDecimalString,
    ExpenseReportId: oracleDecimalString,
    ExpenseReference: oracleNonNullableInteger,
    ExpenseType: oracleText,
    ExpenseTypeId: oracleDecimalString,
    ExpenseTemplate: oracleText,
    ExpenseTemplateId: oracleDecimalString,
    BusinessUnit: oracleText,
    OrgId: oracleNonNullableDecimalString,
    AssignmentId: oracleNonNullableDecimalString,
    PersonId: oracleNonNullableDecimalString,
    PersonName: oracleText,
    Description: oracleText,
    Justification: oracleText,
    ReceiptAmount: oracleNumber,
    ReceiptCurrencyCode: oracleText,
    ReceiptDate: oracleText,
    ReimbursableAmount: oracleNumber,
    ReimbursementCurrencyCode: oracleText,
    MerchantName: oracleText,
    StartDate: oracleText,
    EndDate: oracleText,
    ItemizationParentExpenseId: oracleExactIntegerString,
    ReceiptMissingFlag: oracleBoolean,
    ImageReceiptRequiredFlag: oracleBoolean,
    ValidationErrorFlag: oracleBoolean,
    ValidationErrorMessages: oracleText,
    ValidationWarningMessages: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListExpenseLinesInputSchema = z.object({
  ...authShape,
  ...listShape,
  expenseReportUniqId: opaqueKeySchema,
})

export const oracleFusionGetExpenseLineInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseLineUniqId: opaqueKeySchema,
})

export const oracleFusionCreateExpenseLineInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
  assignmentId: financialsExactIntegerInput.transform(oracleFusionExactInteger),
  orgId: financialsExactIntegerInput.transform(oracleFusionExactInteger),
  personId: financialsExactIntegerInput.transform(oracleFusionExactInteger),
  ticketClass: z.string().max(80).min(1),
  expenseTypeId: financialsExactIntegerInput
    .transform(oracleFusionExactInteger)
    .nullable()
    .optional(),
  expenseTemplateId: financialsExactIntegerInput
    .transform(oracleFusionExactInteger)
    .nullable()
    .optional(),
  description: z.string().max(240).nullable().optional(),
  justification: z.string().max(240).nullable().optional(),
  receiptAmount: z.number().finite().nullable().optional(),
  receiptCurrencyCode: z.string().max(15).nullable().optional(),
  receiptDate: financialsDateInput.nullable().optional(),
  merchantName: z.string().max(80).nullable().optional(),
  startDate: financialsDateInput.nullable().optional(),
  endDate: z.string().max(8000).nullable().optional(),
  exchangeRate: z.number().finite().nullable().optional(),
  reimbursementCurrencyCode: z.string().max(15).nullable().optional(),
  itemizationParentExpenseId: expenseItemizationParentInput
    .transform(oracleFusionExactInteger)
    .nullable()
    .optional(),
  receiptMissingFlag: z.boolean().nullable().optional(),
  location: z.string().max(80).nullable().optional(),
  countryCode: z.string().max(8000).nullable().optional(),
  expenseCategoryCode: z.string().max(30).nullable().optional(),
  expenseSource: z.string().max(30).nullable().optional(),
  numberOfDays: z.number().int().safe().nullable().optional(),
  numberOfAttendees: z.number().finite().nullable().optional(),
  tripDistance: z.number().finite().nullable().optional(),
  distanceUnitCode: z.string().max(30).nullable().optional(),
  ticketClassCode: z.string().max(30).nullable().optional(),
  ticketNumber: z.string().max(80).nullable().optional(),
})

export const oracleFusionUpdateExpenseLineInputSchema = z
  .object({
    ...authShape,
    expenseReportUniqId: opaqueKeySchema,
    expenseLineUniqId: opaqueKeySchema,
    assignmentId: financialsExactIntegerInput.transform(oracleFusionExactInteger).optional(),
    orgId: financialsExactIntegerInput.transform(oracleFusionExactInteger).optional(),
    personId: financialsExactIntegerInput.transform(oracleFusionExactInteger).optional(),
    ticketClass: z.string().max(80).optional(),
    expenseTypeId: financialsExactIntegerInput
      .transform(oracleFusionExactInteger)
      .nullable()
      .optional(),
    expenseTemplateId: financialsExactIntegerInput
      .transform(oracleFusionExactInteger)
      .nullable()
      .optional(),
    description: z.string().max(240).nullable().optional(),
    justification: z.string().max(240).nullable().optional(),
    receiptAmount: z.number().finite().nullable().optional(),
    receiptCurrencyCode: z.string().max(15).nullable().optional(),
    receiptDate: financialsDateInput.nullable().optional(),
    merchantName: z.string().max(80).nullable().optional(),
    startDate: financialsDateInput.nullable().optional(),
    endDate: z.string().max(8000).nullable().optional(),
    exchangeRate: z.number().finite().nullable().optional(),
    reimbursementCurrencyCode: z.string().max(15).nullable().optional(),
    itemizationParentExpenseId: expenseItemizationParentInput
      .transform(oracleFusionExactInteger)
      .nullable()
      .optional(),
    receiptMissingFlag: z.boolean().nullable().optional(),
    location: z.string().max(80).nullable().optional(),
    countryCode: z.string().max(8000).nullable().optional(),
    expenseCategoryCode: z.string().max(30).nullable().optional(),
    expenseSource: z.string().max(30).nullable().optional(),
    numberOfDays: z.number().int().safe().nullable().optional(),
    numberOfAttendees: z.number().finite().nullable().optional(),
    tripDistance: z.number().finite().nullable().optional(),
    distanceUnitCode: z.string().max(30).nullable().optional(),
    ticketClassCode: z.string().max(30).nullable().optional(),
    ticketNumber: z.string().max(80).nullable().optional(),
  })
  .refine(
    (input) =>
      [
        input.assignmentId,
        input.orgId,
        input.personId,
        input.ticketClass,
        input.expenseTypeId,
        input.expenseTemplateId,
        input.description,
        input.justification,
        input.receiptAmount,
        input.receiptCurrencyCode,
        input.receiptDate,
        input.merchantName,
        input.startDate,
        input.endDate,
        input.exchangeRate,
        input.reimbursementCurrencyCode,
        input.itemizationParentExpenseId,
        input.receiptMissingFlag,
        input.location,
        input.countryCode,
        input.expenseCategoryCode,
        input.expenseSource,
        input.numberOfDays,
        input.numberOfAttendees,
        input.tripDistance,
        input.distanceUnitCode,
        input.ticketClassCode,
        input.ticketNumber,
      ].some((value) => value !== undefined),
    'Provide at least one supported update attribute'
  )

export const ORACLE_FUSION_EXPENSE_DISTRIBUTION_FIELDS = [
  'ExpenseDistId',
  'ExpenseId',
  'ExpenseReportId',
  'OrgId',
  'BusinessUnit',
  'CodeCombinationId',
  'Company',
  'CostCenter',
  'ReimbursableAmount',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionExpenseDistributionSchema = z
  .object({
    ExpenseDistId: oracleNonNullableDecimalString,
    ExpenseId: oracleNonNullableDecimalString,
    ExpenseReportId: oracleDecimalString,
    OrgId: oracleNonNullableDecimalString,
    BusinessUnit: oracleText,
    CodeCombinationId: oracleDecimalString,
    Company: oracleText,
    CostCenter: oracleText,
    ReimbursableAmount: oracleNumber,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListExpenseDistributionsInputSchema = z.object({
  ...authShape,
  ...listShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseLineUniqId: opaqueKeySchema,
})

export const oracleFusionGetExpenseDistributionInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseLineUniqId: opaqueKeySchema,
  expenseDistributionId: financialsExactIntegerInput,
})

export const oracleFusionCreateExpenseDistributionInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseLineUniqId: opaqueKeySchema,
  expenseId: financialsExactIntegerInput.transform(oracleFusionExactInteger),
  orgId: financialsExactIntegerInput.transform(oracleFusionExactInteger),
  codeCombinationId: financialsExactIntegerInput
    .transform(oracleFusionExactInteger)
    .nullable()
    .optional(),
  company: z.string().max(25).nullable().optional(),
  costCenter: z.string().max(8000).nullable().optional(),
  reimbursableAmount: z.number().finite().nullable().optional(),
})

export const oracleFusionUpdateExpenseDistributionInputSchema = z
  .object({
    ...authShape,
    expenseReportUniqId: opaqueKeySchema,
    expenseLineUniqId: opaqueKeySchema,
    expenseDistributionId: financialsExactIntegerInput,
    expenseId: financialsExactIntegerInput.transform(oracleFusionExactInteger),
    orgId: financialsExactIntegerInput.transform(oracleFusionExactInteger),
    codeCombinationId: financialsExactIntegerInput
      .transform(oracleFusionExactInteger)
      .nullable()
      .optional(),
    company: z.string().max(25).nullable().optional(),
    costCenter: z.string().max(8000).nullable().optional(),
    reimbursableAmount: z.number().finite().nullable().optional(),
  })
  .refine(
    (input) =>
      [
        input.expenseId,
        input.orgId,
        input.codeCombinationId,
        input.company,
        input.costCenter,
        input.reimbursableAmount,
      ].some((value) => value !== undefined),
    'Provide at least one supported update attribute'
  )

export const ORACLE_FUSION_EXPENSE_ITEMIZATION_FIELDS = [
  'ExpenseId',
  'ExpenseReportId',
  'ItemizationParentExpenseId',
  'OrgId',
  'AssignmentId',
  'PersonId',
  'ExpenseType',
  'ExpenseTypeId',
  'Description',
  'Justification',
  'ReceiptAmount',
  'ReceiptCurrencyCode',
  'ReceiptDate',
  'ReimbursableAmount',
  'ReimbursementCurrencyCode',
  'MerchantName',
  'StartDate',
  'EndDate',
  'ImgReceiptRequiredFlag',
  'ValidationErrorFlag',
  'ValidationErrorMessages',
  'ValidationWarningMessages',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionExpenseItemizationSchema = z
  .object({
    ExpenseId: oracleNonNullableDecimalString,
    ExpenseReportId: oracleDecimalString,
    ItemizationParentExpenseId: oracleExactIntegerString,
    OrgId: oracleNonNullableDecimalString,
    AssignmentId: oracleNonNullableDecimalString,
    PersonId: oracleNonNullableDecimalString,
    ExpenseType: oracleText,
    ExpenseTypeId: oracleDecimalString,
    Description: oracleText,
    Justification: oracleText,
    ReceiptAmount: oracleNumber,
    ReceiptCurrencyCode: oracleText,
    ReceiptDate: oracleText,
    ReimbursableAmount: oracleNumber,
    ReimbursementCurrencyCode: oracleText,
    MerchantName: oracleText,
    StartDate: oracleText,
    EndDate: oracleText,
    ImgReceiptRequiredFlag: oracleBoolean,
    ValidationErrorFlag: oracleBoolean,
    ValidationErrorMessages: oracleText,
    ValidationWarningMessages: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListExpenseItemizationsInputSchema = z.object({
  ...authShape,
  ...listShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseLineUniqId: opaqueKeySchema,
})

export const oracleFusionGetExpenseItemizationInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseLineUniqId: opaqueKeySchema,
  expenseItemizationId: financialsExactIntegerInput,
})

export const oracleFusionCreateExpenseItemizationInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseLineUniqId: opaqueKeySchema,
  assignmentId: financialsExactIntegerInput.transform(oracleFusionExactInteger).optional(),
  orgId: financialsExactIntegerInput.transform(oracleFusionExactInteger).optional(),
  personId: financialsExactIntegerInput.transform(oracleFusionExactInteger).optional(),
  expenseTypeId: financialsExactIntegerInput
    .transform(oracleFusionExactInteger)
    .nullable()
    .optional(),
  expenseTemplateId: financialsExactIntegerInput
    .transform(oracleFusionExactInteger)
    .nullable()
    .optional(),
  itemizationParentExpenseId: expenseItemizationParentInput
    .transform(oracleFusionExactInteger)
    .nullable()
    .optional(),
  description: z.string().max(240).nullable().optional(),
  justification: z.string().max(240).nullable().optional(),
  receiptAmount: z.number().finite().nullable().optional(),
  receiptCurrencyCode: z.string().max(15).nullable().optional(),
  receiptDate: financialsDateInput.nullable().optional(),
  merchantName: z.string().max(80).nullable().optional(),
  startDate: financialsDateInput.nullable().optional(),
  endDate: z.string().max(8000).nullable().optional(),
  exchangeRate: z.number().finite().nullable().optional(),
  reimbursementCurrencyCode: z.string().max(15).nullable().optional(),
  receiptMissingFlag: z.boolean().nullable().optional(),
  location: z.string().max(80).nullable().optional(),
  expenseCategoryCode: z.string().max(30).nullable().optional(),
  numberOfDays: z.number().int().safe().nullable().optional(),
  numberOfAttendees: z.number().finite().nullable().optional(),
})

export const oracleFusionUpdateExpenseItemizationInputSchema = z
  .object({
    ...authShape,
    expenseReportUniqId: opaqueKeySchema,
    expenseLineUniqId: opaqueKeySchema,
    expenseItemizationId: financialsExactIntegerInput,
    assignmentId: financialsExactIntegerInput.transform(oracleFusionExactInteger).optional(),
    orgId: financialsExactIntegerInput.transform(oracleFusionExactInteger).optional(),
    personId: financialsExactIntegerInput.transform(oracleFusionExactInteger).optional(),
    expenseTypeId: financialsExactIntegerInput
      .transform(oracleFusionExactInteger)
      .nullable()
      .optional(),
    expenseTemplateId: financialsExactIntegerInput
      .transform(oracleFusionExactInteger)
      .nullable()
      .optional(),
    itemizationParentExpenseId: expenseItemizationParentInput
      .transform(oracleFusionExactInteger)
      .nullable()
      .optional(),
    description: z.string().max(240).nullable().optional(),
    justification: z.string().max(240).nullable().optional(),
    receiptAmount: z.number().finite().nullable().optional(),
    receiptCurrencyCode: z.string().max(15).nullable().optional(),
    receiptDate: financialsDateInput.nullable().optional(),
    merchantName: z.string().max(80).nullable().optional(),
    startDate: financialsDateInput.nullable().optional(),
    endDate: z.string().max(8000).nullable().optional(),
    exchangeRate: z.number().finite().nullable().optional(),
    reimbursementCurrencyCode: z.string().max(15).nullable().optional(),
    receiptMissingFlag: z.boolean().nullable().optional(),
    location: z.string().max(80).nullable().optional(),
    expenseCategoryCode: z.string().max(30).nullable().optional(),
    numberOfDays: z.number().int().safe().nullable().optional(),
    numberOfAttendees: z.number().finite().nullable().optional(),
  })
  .refine(
    (input) =>
      [
        input.assignmentId,
        input.orgId,
        input.personId,
        input.expenseTypeId,
        input.expenseTemplateId,
        input.itemizationParentExpenseId,
        input.description,
        input.justification,
        input.receiptAmount,
        input.receiptCurrencyCode,
        input.receiptDate,
        input.merchantName,
        input.startDate,
        input.endDate,
        input.exchangeRate,
        input.reimbursementCurrencyCode,
        input.receiptMissingFlag,
        input.location,
        input.expenseCategoryCode,
        input.numberOfDays,
        input.numberOfAttendees,
      ].some((value) => value !== undefined),
    'Provide at least one supported update attribute'
  )

export const ORACLE_FUSION_EXPENSE_REPORT_PROCESSING_DETAIL_FIELDS = [
  'ExpenseReportProcessingId',
  'ExpenseReportId',
  'Event',
  'EventDate',
  'EventPerformerId',
  'EventPerformerName',
  'AuditCode',
  'AuditReturnReasonCode',
  'CreationDate',
] as const

export const oracleFusionExpenseReportProcessingDetailSchema = z
  .object({
    expenseReportProcessingDetailUniqId: z.string().optional(),
    ExpenseReportProcessingId: oracleNonNullableInteger,
    ExpenseReportId: oracleNonNullableDecimalString,
    Event: oracleNonNullableText,
    EventDate: oracleText,
    EventPerformerId: oracleText,
    EventPerformerName: oracleText,
    AuditCode: oracleText,
    AuditReturnReasonCode: oracleText,
    CreationDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListExpenseReportProcessingDetailsInputSchema = z.object({
  ...authShape,
  ...listShape,
  expenseReportUniqId: opaqueKeySchema,
})

export const oracleFusionGetExpenseReportProcessingDetailInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseReportProcessingDetailUniqId: opaqueKeySchema,
})

export const ORACLE_FUSION_EXPENSE_REPORT_PAYMENT_FIELDS = [
  'ExpenseReportId',
  'InvoiceId',
  'CheckId',
  'CheckNumber',
  'PaymentNumber',
  'PaymentAmount',
  'PaymentCurrencyCode',
  'PaymentDate',
  'PaymentMethod',
  'PaymentMethodCode',
  'ProcessingType',
] as const

export const oracleFusionExpenseReportPaymentSchema = z
  .object({
    ExpenseReportId: oracleNonNullableDecimalString,
    InvoiceId: oracleNonNullableDecimalString,
    CheckId: oracleNonNullableDecimalString,
    CheckNumber: oracleNonNullableExactIntegerString,
    PaymentNumber: oracleNonNullableExactIntegerString,
    PaymentAmount: oracleNonNullableNumber,
    PaymentCurrencyCode: oracleText,
    PaymentDate: oracleNonNullableText,
    PaymentMethod: oracleText,
    PaymentMethodCode: oracleText,
    ProcessingType: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListExpenseReportPaymentsInputSchema = z.object({
  ...authShape,
  ...listShape,
  expenseReportUniqId: opaqueKeySchema,
})

export const oracleFusionGetExpenseReportPaymentInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseReportPaymentId: financialsExactIntegerInput,
})

export const ORACLE_FUSION_EXPENSE_LINE_ERROR_FIELDS = [
  'ErrorSequence',
  'ErrorCode',
  'ErrorDescription',
  'Name',
  'Type',
] as const

export const oracleFusionExpenseLineErrorSchema = z
  .object({
    ErrorSequence: oracleInteger,
    ErrorCode: oracleText,
    ErrorDescription: oracleText,
    Name: oracleText,
    Type: oracleText,
  })
  .passthrough()

export const oracleFusionListExpenseLineErrorsInputSchema = z.object({
  ...authShape,
  ...listShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseLineUniqId: opaqueKeySchema,
})

export const oracleFusionGetExpenseLineErrorInputSchema = z.object({
  ...authShape,
  expenseReportUniqId: opaqueKeySchema,
  expenseLineUniqId: opaqueKeySchema,
  expenseLineErrorSequence: financialsExactIntegerInput,
})

export const ORACLE_FUSION_GL_LEDGER_FIELDS = [
  'LedgerId',
  'Name',
  'Description',
  'CurrencyCode',
  'ChartOfAccountsId',
  'AccountedPeriodType',
  'PeriodSetName',
  'LedgerCategoryCode',
  'LedgerTypeCode',
  'EnableBudgetaryControlFlag',
] as const

export const oracleFusionGlLedgerSchema = z
  .object({
    LedgerId: oracleDecimalString,
    Name: oracleNonNullableText,
    Description: oracleText,
    CurrencyCode: oracleNonNullableText,
    ChartOfAccountsId: oracleNonNullableDecimalString,
    AccountedPeriodType: oracleNonNullableText,
    PeriodSetName: oracleNonNullableText,
    LedgerCategoryCode: oracleNonNullableText,
    LedgerTypeCode: oracleNonNullableText,
    EnableBudgetaryControlFlag: oracleNonNullableBoolean,
  })
  .passthrough()

export const oracleFusionListGlLedgersInputSchema = z.object({
  ...authShape,
  ...listShape,
})

export const oracleFusionGetGlLedgerInputSchema = z.object({
  ...authShape,
  glLedgerId: financialsExactIntegerInput,
})

export const ORACLE_FUSION_GL_JOURNAL_BATCH_FIELDS = [
  'JeBatchId',
  'BatchName',
  'BatchDescription',
  'DefaultPeriodName',
  'Status',
  'StatusMeaning',
  'CompletionStatusMeaning',
  'ApprovalStatusMeaning',
  'FundsStatusMeaning',
  'UserJeSourceName',
  'ChartOfAccountsName',
  'UserPeriodSetName',
  'AccountedPeriodType',
  'ActualFlagMeaning',
  'RunningTotalCr',
  'RunningTotalDr',
  'RunningTotalAccountedCr',
  'RunningTotalAccountedDr',
  'ControlTotal',
  'PostedDate',
  'ReversalFlag',
  'ReversalDate',
  'ReversalMethodMeaning',
  'ReversalPeriod',
  'ErrorMessage',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionGlJournalBatchSchema = z
  .object({
    JeBatchId: oracleNonNullableDecimalString,
    BatchName: oracleNonNullableText,
    BatchDescription: oracleText,
    DefaultPeriodName: oracleText,
    Status: oracleNonNullableText,
    StatusMeaning: oracleText,
    CompletionStatusMeaning: oracleText,
    ApprovalStatusMeaning: oracleNonNullableText,
    FundsStatusMeaning: oracleNonNullableText,
    UserJeSourceName: oracleNonNullableText,
    ChartOfAccountsName: oracleNonNullableText,
    UserPeriodSetName: oracleNonNullableText,
    AccountedPeriodType: oracleNonNullableText,
    ActualFlagMeaning: oracleNonNullableText,
    RunningTotalCr: oracleNumber,
    RunningTotalDr: oracleNumber,
    RunningTotalAccountedCr: oracleNumber,
    RunningTotalAccountedDr: oracleNumber,
    ControlTotal: oracleNumber,
    PostedDate: oracleText,
    ReversalFlag: oracleBoolean,
    ReversalDate: oracleText,
    ReversalMethodMeaning: oracleText,
    ReversalPeriod: oracleText,
    ErrorMessage: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListGlJournalBatchesInputSchema = z.object({
  ...authShape,
  ...listShape,
})

export const oracleFusionGetGlJournalBatchInputSchema = z.object({
  ...authShape,
  glJournalBatchId: financialsExactIntegerInput,
})

export const oracleFusionDeleteGlJournalBatchInputSchema = z.object({
  ...authShape,
  glJournalBatchId: financialsExactIntegerInput,
})

export const ORACLE_FUSION_GL_JOURNAL_HEADER_FIELDS = [
  'JournalName',
  'JournalDescription',
  'LedgerName',
  'LedgerCurrencyCode',
  'CurrencyCode',
  'PeriodName',
  'DefaultEffectiveDate',
  'UserJeCategoryName',
  'UserCurrencyConversionType',
  'CurrencyConversionDate',
  'CurrencyConversionRate',
  'RunningTotalCr',
  'RunningTotalDr',
  'RunningTotalAccountedCr',
  'RunningTotalAccountedDr',
  'ControlTotal',
  'LegalEntityName',
  'ExternalReference',
  'AccrualReversalStatus',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionGlJournalHeaderSchema = z
  .object({
    glJournalHeaderUniqId: z.string().optional(),
    JournalName: oracleNonNullableText,
    JournalDescription: oracleText,
    LedgerName: oracleNonNullableText,
    LedgerCurrencyCode: oracleNonNullableText,
    CurrencyCode: oracleText,
    PeriodName: oracleNonNullableText,
    DefaultEffectiveDate: oracleNonNullableText,
    UserJeCategoryName: oracleNonNullableText,
    UserCurrencyConversionType: oracleNonNullableText,
    CurrencyConversionDate: oracleText,
    CurrencyConversionRate: oracleNumber,
    RunningTotalCr: oracleNumber,
    RunningTotalDr: oracleNumber,
    RunningTotalAccountedCr: oracleNumber,
    RunningTotalAccountedDr: oracleNumber,
    ControlTotal: oracleNumber,
    LegalEntityName: oracleNonNullableText,
    ExternalReference: oracleText,
    AccrualReversalStatus: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListGlJournalHeadersInputSchema = z.object({
  ...authShape,
  ...listShape,
  glJournalBatchId: financialsExactIntegerInput,
})

export const oracleFusionGetGlJournalHeaderInputSchema = z.object({
  ...authShape,
  glJournalBatchId: financialsExactIntegerInput,
  glJournalHeaderUniqId: opaqueKeySchema,
})

export const ORACLE_FUSION_GL_JOURNAL_LINE_FIELDS = [
  'JeLineNumber',
  'AccountCombination',
  'AccountedCr',
  'AccountedDr',
  'EnteredCr',
  'EnteredDr',
  'CurrencyCode',
  'CurrencyConversionDate',
  'CurrencyConversionRate',
  'Description',
  'ChartOfAccountsName',
  'StatAmount',
  'ReconciliationReference',
  'jgzzReconStatusMeaning',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionGlJournalLineSchema = z
  .object({
    glJournalLineUniqId: z.string().optional(),
    JeLineNumber: oracleNonNullableExactIntegerString,
    AccountCombination: oracleText,
    AccountedCr: oracleNumber,
    AccountedDr: oracleNumber,
    EnteredCr: oracleNumber,
    EnteredDr: oracleNumber,
    CurrencyCode: oracleNonNullableText,
    CurrencyConversionDate: oracleNonNullableText,
    CurrencyConversionRate: oracleNonNullableNumber,
    Description: oracleText,
    ChartOfAccountsName: oracleNonNullableText,
    StatAmount: oracleNumber,
    ReconciliationReference: oracleText,
    jgzzReconStatusMeaning: oracleNonNullableText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListGlJournalLinesInputSchema = z.object({
  ...authShape,
  ...listShape,
  glJournalBatchId: financialsExactIntegerInput,
  glJournalHeaderUniqId: opaqueKeySchema,
})

export const oracleFusionGetGlJournalLineInputSchema = z.object({
  ...authShape,
  glJournalBatchId: financialsExactIntegerInput,
  glJournalHeaderUniqId: opaqueKeySchema,
  glJournalLineUniqId: opaqueKeySchema,
})

export const ORACLE_FUSION_GL_JOURNAL_ERROR_FIELDS = [
  'BatchName',
  'HeaderName',
  'ErrorNumber',
  'JeLineNumber',
  'ErrorMessage',
  'ErrorMessageName',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionGlJournalErrorSchema = z
  .object({
    glJournalErrorUniqId: z.string().optional(),
    BatchName: oracleNonNullableText,
    HeaderName: oracleText,
    ErrorNumber: oracleNonNullableExactIntegerString,
    JeLineNumber: oracleNonNullableExactIntegerString,
    ErrorMessage: oracleText,
    ErrorMessageName: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListGlJournalErrorsInputSchema = z.object({
  ...authShape,
  ...listShape,
  glJournalBatchId: financialsExactIntegerInput,
})

export const oracleFusionGetGlJournalErrorInputSchema = z.object({
  ...authShape,
  glJournalBatchId: financialsExactIntegerInput,
  glJournalErrorUniqId: opaqueKeySchema,
})

export const ORACLE_FUSION_GL_JOURNAL_ACTION_LOG_FIELDS = [
  'ActionCodeMeaning',
  'ActionDate',
  'UserName',
  'CreationDate',
  'LastUpdateDate',
] as const

export const oracleFusionGlJournalActionLogSchema = z
  .object({
    glJournalActionLogUniqId: z.string().optional(),
    ActionCodeMeaning: oracleNonNullableText,
    ActionDate: oracleNonNullableText,
    UserName: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
  })
  .passthrough()

export const oracleFusionListGlJournalActionLogsInputSchema = z.object({
  ...authShape,
  ...listShape,
  glJournalBatchId: financialsExactIntegerInput,
})

export const oracleFusionGetGlJournalActionLogInputSchema = z.object({
  ...authShape,
  glJournalBatchId: financialsExactIntegerInput,
  glJournalActionLogUniqId: opaqueKeySchema,
})

export const ORACLE_FUSION_GL_BALANCE_FIELDS = [
  'AccountCombination',
  'AccountGroupName',
  'AccountName',
  'ActualBalance',
  'AmountType',
  'BeginningBalance',
  'BudgetBalance',
  'Currency',
  'CurrencyType',
  'CurrentAccountingPeriod',
  'CurrentPeriodBalance',
  'DetailAccountCombination',
  'EndingBalance',
  'ErrorDetail',
  'LedgerName',
  'LedgerSetName',
  'PeriodActivity',
  'PeriodName',
  'Scenario',
] as const

export const oracleFusionGlBalanceSchema = z
  .object({
    AccountCombination: oracleText,
    AccountGroupName: oracleText,
    AccountName: oracleText,
    ActualBalance: oracleText,
    AmountType: oracleText,
    BeginningBalance: oracleText,
    BudgetBalance: oracleText,
    Currency: oracleText,
    CurrencyType: oracleText,
    CurrentAccountingPeriod: oracleText,
    CurrentPeriodBalance: oracleText,
    DetailAccountCombination: oracleText,
    EndingBalance: oracleText,
    ErrorDetail: oracleText,
    LedgerName: oracleText,
    LedgerSetName: oracleText,
    PeriodActivity: oracleText,
    PeriodName: oracleText,
    Scenario: oracleText,
  })
  .passthrough()

export const oracleFusionListGlBalancesInputSchema = z.object({
  ...authShape,
  ...listShape,
})
