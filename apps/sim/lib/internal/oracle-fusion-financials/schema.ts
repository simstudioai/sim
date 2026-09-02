import { z } from 'zod'
import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'

export const ORACLE_FUSION_FINANCIALS_RESOURCE_PATH = '/fscmRestApi/resources/11.13.18.05' as const

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
const oracleDecimalString = z.string().regex(/^\d+$/).nullable().optional()
const oracleNonNullableDecimalString = z.string().regex(/^\d+$/).optional()
const linkSchema = z
  .object({ rel: z.string().optional(), href: z.string().optional() })
  .passthrough()
const linksShape = { links: z.array(linkSchema).optional() }

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
    ...linksShape,
  })
  .passthrough()

export const oracleFusionInvoiceLineSchema = z
  .object({
    LineNumber: oracleNonNullableInteger,
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
    ReceiptLineNumber: oracleInteger,
    Item: oracleText,
    ItemDescription: oracleText,
    TaxClassification: oracleText,
    TaxRateCode: oracleText,
    ShipToLocation: oracleText,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
    ...linksShape,
  })
  .passthrough()

export const oracleFusionInstallmentSchema = z
  .object({
    InstallmentNumber: oracleNonNullableInteger,
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
    ...linksShape,
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
    ReceiptLineNumber: oracleNonNullableInteger,
    PrepaymentNumber: oracleText,
    PrepaymentLineNumber: oracleText,
    TaxName: oracleText,
    TaxRate: oracleText,
    AssetBook: oracleText,
    TrackAsAssetFlag: oracleNonNullableBoolean,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
    ...linksShape,
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
    ...linksShape,
  })
  .passthrough()

export const oracleFusionAvailablePrepaymentSchema = z
  .object({
    InvoiceNumber: oracleNonNullableText,
    LineNumber: oracleNonNullableInteger,
    Description: oracleText,
    SupplierSite: oracleNonNullableText,
    PurchaseOrder: oracleText,
    Currency: oracleNonNullableText,
    AvailableAmount: oracleNumber,
    IncludedTax: oracleNumber,
    ...linksShape,
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
    ...linksShape,
  })
  .passthrough()

export const oracleFusionPaymentRelatedInvoiceSchema = z
  .object({
    InvoicePaymentId: oracleNonNullableDecimalString,
    CheckId: oracleNonNullableDecimalString,
    InvoiceId: oracleNonNullableDecimalString,
    InvoiceBusinessUnit: oracleText,
    InvoiceNumber: oracleNonNullableText,
    InstallmentNumber: oracleNonNullableInteger,
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
    ...linksShape,
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
    ReceiptLineNumber: oracleNonNullableInteger,
    CreationDate: oracleNonNullableText,
    LastUpdateDate: oracleNonNullableText,
    ...linksShape,
  })
  .passthrough()

export const oracleFusionPaymentProcessRequestSchema = z
  .object({
    PaymentProcessRequestId: oracleNonNullableDecimalString,
    PaymentProcessRequestName: oracleNonNullableText,
    SourceApplicationIdentifier: oracleNonNullableDecimalString,
    PaymentProcessRequestStatusCode: oracleNonNullableText,
    PaymentProcessRequestStatusMeaning: oracleText,
    ...linksShape,
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
    rank: oracleInteger,
    setId: oracleNonNullableDecimalString,
    creationDate: oracleNonNullableText,
    lastUpdateDate: oracleNonNullableText,
    ...linksShape,
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
    ...linksShape,
  })
  .passthrough()

export const oracleFusionListEnvelopeSchema = z
  .object({
    items: z.array(z.unknown()).max(100).default([]),
    count: z.number().int().nonnegative().max(100),
    hasMore: z.boolean(),
    limit: z.number().int().positive().max(100),
    offset: z.number().int().nonnegative(),
    totalResults: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .refine((value) => value.count === value.items.length, {
    message: 'Oracle list count must match the returned items',
  })

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

const opaqueKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (value) => value !== '.' && value !== '..' && !/[\\/?#\u0000-\u001f\u007f]/.test(value),
    'Oracle opaque key must be one URL path segment'
  )

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

function getOnlySelfLink(value: unknown): URL {
  const parsed = z.object(linksShape).passthrough().parse(value)
  const selfLinks = (parsed.links ?? []).filter((link) => link.rel === 'self')
  if (selfLinks.length !== 1 || typeof selfLinks[0]?.href !== 'string') {
    throw new Error('Oracle response must include exactly one self link')
  }
  try {
    return new URL(selfLinks[0].href)
  } catch {
    throw new Error('Oracle self link is malformed')
  }
}

function validateSelfLinkBase(link: URL, instanceUrl: string): void {
  const origin = normalizeOracleFusionApplicationOrigin(instanceUrl)
  if (
    !origin ||
    link.origin !== origin ||
    link.username !== '' ||
    link.password !== '' ||
    link.search !== '' ||
    link.hash !== ''
  ) {
    throw new Error('Oracle self link does not match the credential-bound origin')
  }
}

/** Requires a canonical same-origin self link for the complete requested resource path. */
export function validateOracleFusionSelfLink(
  value: unknown,
  instanceUrl: string,
  expectedPath: string
): void {
  const link = getOnlySelfLink(value)
  validateSelfLinkBase(link, instanceUrl)
  if (link.pathname !== expectedPath) {
    throw new Error('Oracle response self link does not match the requested resource path')
  }
}

/** Derives one opaque Oracle key from a canonical same-origin collection self link. */
export function extractOracleFusionOpaqueKey(
  value: unknown,
  instanceUrl: string,
  collectionPath: string
): string {
  const link = getOnlySelfLink(value)
  validateSelfLinkBase(link, instanceUrl)
  const prefix = `${collectionPath}/`
  if (!link.pathname.startsWith(prefix)) {
    throw new Error('Oracle self link does not match the requested collection path')
  }
  const encodedKey = link.pathname.slice(prefix.length)
  if (!encodedKey || encodedKey.includes('/') || /%(?:2f|5c)/i.test(encodedKey)) {
    throw new Error('Oracle self link does not contain one opaque key segment')
  }
  let key: string
  try {
    key = decodeURIComponent(encodedKey)
  } catch {
    throw new Error('Oracle self link contains invalid URL encoding')
  }
  return opaqueKeySchema.parse(key)
}

export function extractInvoiceUniqId(value: unknown, instanceUrl: string): string {
  return extractOracleFusionOpaqueKey(
    value,
    instanceUrl,
    `${ORACLE_FUSION_FINANCIALS_RESOURCE_PATH}/invoices`
  )
}
