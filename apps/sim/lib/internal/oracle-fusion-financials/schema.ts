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

const oracleText = z.string().nullable().optional()
const oracleNumber = z.number().finite().nullable().optional()
const oracleBoolean = z.boolean().nullable().optional()
const linkSchema = z
  .object({ rel: z.string().optional(), href: z.string().optional() })
  .passthrough()

export const oracleFusionInvoiceSchema = z
  .object({
    InvoiceId: oracleNumber,
    InvoiceNumber: oracleText,
    Supplier: oracleText,
    SupplierNumber: oracleText,
    SupplierSite: oracleText,
    BusinessUnit: oracleText,
    InvoiceAmount: oracleNumber,
    InvoiceCurrency: oracleText,
    InvoiceDate: oracleText,
    AccountingDate: oracleText,
    AmountPaid: oracleNumber,
    PaidStatus: oracleText,
    ApprovalStatus: oracleText,
    ValidationStatus: oracleText,
    PaymentTerms: oracleText,
    PaymentMethod: oracleText,
    PurchaseOrderNumber: oracleText,
    Description: oracleText,
    CreationDate: oracleText,
    LastUpdateDate: oracleText,
    links: z.array(linkSchema).optional(),
  })
  .passthrough()

export const oracleFusionInvoiceLineSchema = z
  .object({
    LineNumber: oracleNumber,
    LineType: oracleText,
    LineAmount: oracleNumber,
    BaseAmount: oracleNumber,
    Description: oracleText,
    Quantity: oracleNumber,
    UOM: oracleText,
    UnitPrice: oracleNumber,
    AccountingDate: oracleText,
    ApprovalStatus: oracleText,
    DiscardedFlag: oracleBoolean,
    CanceledFlag: oracleBoolean,
    TrackAsAssetFlag: oracleBoolean,
    PurchaseOrderNumber: oracleText,
    PurchaseOrderLineNumber: oracleNumber,
    ReceiptNumber: oracleText,
    ReceiptLineNumber: oracleNumber,
    Item: oracleText,
    ItemDescription: oracleText,
    TaxClassification: oracleText,
    TaxRateCode: oracleText,
    ShipToLocation: oracleText,
    CreationDate: oracleText,
    LastUpdateDate: oracleText,
  })
  .passthrough()

export const oracleFusionInstallmentSchema = z
  .object({
    InstallmentNumber: oracleNumber,
    DueDate: oracleText,
    GrossAmount: oracleNumber,
    UnpaidAmount: oracleNumber,
    PaymentMethod: oracleText,
    PaymentPriority: oracleNumber,
    HoldFlag: oracleBoolean,
    HoldReason: oracleText,
    FirstDiscountDate: oracleText,
    FirstDiscountAmount: oracleNumber,
    SecondDiscountDate: oracleText,
    SecondDiscountAmount: oracleNumber,
    ThirdDiscountDate: oracleText,
    ThirdDiscountAmount: oracleNumber,
    CreationDate: oracleText,
    LastUpdateDate: oracleText,
  })
  .passthrough()

export const oracleFusionPaymentSchema = z
  .object({
    CheckId: oracleNumber,
    PaymentId: oracleNumber,
    PaymentReference: oracleNumber,
    PaymentNumber: oracleNumber,
    PaymentAmount: oracleNumber,
    PaymentCurrency: oracleText,
    PaymentDate: oracleText,
    AccountingDate: oracleText,
    Payee: oracleText,
    PayeeSite: oracleText,
    SupplierNumber: oracleText,
    PaymentMethod: oracleText,
    PaymentStatus: oracleText,
    PaymentType: oracleText,
    BusinessUnit: oracleText,
    LegalEntity: oracleText,
    ReconciledFlag: oracleBoolean,
    CreationDate: oracleText,
    LastUpdateDate: oracleText,
  })
  .passthrough()

export const oracleFusionListEnvelopeSchema = z
  .object({
    items: z.array(z.unknown()).max(100),
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

const invoiceUniqIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (value) => value !== '.' && value !== '..' && !/[\\/?#\u0000-\u001f\u007f]/.test(value),
    'invoiceUniqId must be one opaque URL path segment'
  )

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

export const oracleFusionGetInvoiceInputSchema = z.object({
  ...authShape,
  invoiceUniqId: invoiceUniqIdSchema,
})

export const oracleFusionInvoiceChildListInputSchema = z.object({
  ...authShape,
  ...listShape,
  invoiceUniqId: invoiceUniqIdSchema,
})

export const oracleFusionListPaymentsInputSchema = z.object({ ...authShape, ...listShape })

export const oracleFusionGetPaymentInputSchema = z.object({
  ...authShape,
  checkId: z
    .string()
    .trim()
    .regex(/^\d{1,64}$/, 'checkId must be a decimal string'),
})

export type OracleFusionAuthInput = z.output<typeof oracleFusionListPaymentsInputSchema>

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

/** Extracts Oracle's opaque invoice key only from a canonical same-origin self link. */
export function extractInvoiceUniqId(value: unknown, instanceUrl: string): string {
  const parsed = oracleFusionInvoiceSchema.parse(value)
  const selfLinks = (parsed.links ?? []).filter((link) => link.rel === 'self')
  if (selfLinks.length !== 1 || typeof selfLinks[0]?.href !== 'string') {
    throw new Error('Oracle invoice response must include exactly one self link')
  }

  let link: URL
  try {
    link = new URL(selfLinks[0].href)
  } catch {
    throw new Error('Oracle invoice self link is malformed')
  }
  const origin = normalizeOracleFusionApplicationOrigin(instanceUrl)
  const prefix = `${ORACLE_FUSION_FINANCIALS_RESOURCE_PATH}/invoices/`
  if (
    !origin ||
    link.origin !== origin ||
    link.username !== '' ||
    link.password !== '' ||
    link.search !== '' ||
    link.hash !== '' ||
    !link.pathname.startsWith(prefix)
  ) {
    throw new Error('Oracle invoice self link does not match the credential-bound invoice path')
  }
  const encodedKey = link.pathname.slice(prefix.length)
  if (!encodedKey || encodedKey.includes('/') || /%(?:2f|5c)/i.test(encodedKey)) {
    throw new Error('Oracle invoice self link does not contain one opaque key segment')
  }
  let key: string
  try {
    key = decodeURIComponent(encodedKey)
  } catch {
    throw new Error('Oracle invoice self link contains invalid URL encoding')
  }
  return invoiceUniqIdSchema.parse(key)
}
