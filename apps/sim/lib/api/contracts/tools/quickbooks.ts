import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import type { ContractBody, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const quickBooksAuthSchema = z.object({
  accessToken: z
    .string()
    .trim()
    .min(1, 'Access token is required')
    .max(8192, 'Access token is too long')
    .refine((value) => !/[\r\n]/.test(value), 'Access token is invalid'),
  realmId: z
    .string()
    .trim()
    .max(64, 'QuickBooks company ID is too long')
    .regex(/^[1-9]\d*$/, 'QuickBooks company ID is invalid'),
  quickBooksEnvironment: z.enum(['sandbox', 'production']),
})

const documentTransactionTypeSchema = z.enum([
  'credit_memo',
  'estimate',
  'invoice',
  'payment',
  'purchase_order',
  'refund_receipt',
  'sales_receipt',
])

const attachmentTargetTypeSchema = z.enum([
  'bill',
  'bill_payment',
  'credit_memo',
  'deposit',
  'estimate',
  'invoice',
  'item',
  'journal_entry',
  'payment',
  'purchase',
  'purchase_order',
  'refund_receipt',
  'sales_receipt',
  'vendor_credit',
])

const optionalFileName = z.string().trim().max(1000, 'Filename is too long').optional().nullable()
const optionalContentType = z
  .string()
  .trim()
  .max(100, 'Content type is too long')
  .optional()
  .nullable()
const optionalDescription = z
  .string()
  .trim()
  .max(2000, 'Description is too long')
  .optional()
  .nullable()
const optionalNote = z.string().trim().max(2000, 'Note is too long').optional().nullable()
const boundedId = z.string().trim().min(1, 'ID is required').max(256, 'ID is too long')
const routeErrorSchema = z.object({ success: z.literal(false), error: z.string().min(1) })
const attachableSchema = z
  .object({
    Id: z.string().min(1),
    FileName: z.string().optional(),
    ContentType: z.string().optional(),
    Size: z.number().optional(),
    Note: z.string().optional(),
  })
  .passthrough()

/**
 * Both QuickBooks document downloads share one internal operation schema.
 * `documentKind` selects whether Intuit returns attachment bytes or a rendered PDF.
 */
export const quickBooksDownloadDocumentBodySchema = z.discriminatedUnion('documentKind', [
  quickBooksAuthSchema.extend({
    documentKind: z.literal('attachment'),
    attachmentId: boundedId,
    fileName: optionalFileName,
  }),
  quickBooksAuthSchema.extend({
    documentKind: z.literal('transaction_pdf'),
    transactionType: documentTransactionTypeSchema,
    transactionId: boundedId,
    fileName: optionalFileName,
  }),
])

export type QuickBooksDownloadDocumentBody = z.output<typeof quickBooksDownloadDocumentBodySchema>

export const quickBooksAddAttachmentBodySchema = quickBooksAuthSchema
  .extend({
    attachmentKind: z.enum(['file', 'note']),
    targetType: attachmentTargetTypeSchema,
    targetId: boundedId,
    file: RawFileInputSchema.optional().nullable(),
    fileName: optionalFileName,
    contentType: optionalContentType,
    description: optionalDescription,
    note: optionalNote,
  })
  .superRefine((value, context) => {
    if (value.attachmentKind === 'file') {
      if (!value.file)
        context.addIssue({
          code: 'custom',
          path: ['file'],
          message: 'File is required in File mode',
        })
      if (value.note)
        context.addIssue({
          code: 'custom',
          path: ['note'],
          message: 'Note-only content is not allowed in File mode',
        })
    } else {
      if (!value.note)
        context.addIssue({
          code: 'custom',
          path: ['note'],
          message: 'Note is required in Note mode',
        })
      if (value.file)
        context.addIssue({
          code: 'custom',
          path: ['file'],
          message: 'A file is not allowed in Note mode',
        })
      if (value.fileName || value.contentType || value.description) {
        context.addIssue({
          code: 'custom',
          path: ['attachmentKind'],
          message: 'File-only fields are not allowed in Note mode',
        })
      }
    }
  })

export type QuickBooksAddAttachmentBody = z.output<typeof quickBooksAddAttachmentBodySchema>

const quickBooksStoredFileShape = {
  file: userFileSchema,
  fileName: z.string().min(1).max(1000),
  size: z.number().int().positive(),
}

export const quickBooksDownloadDocumentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/download-document',
  body: quickBooksDownloadDocumentBodySchema,
  response: {
    mode: 'json',
    schema: z.union([
      z.object({
        success: z.literal(true),
        output: z.object({
          ...quickBooksStoredFileShape,
          attachmentId: boundedId,
          mimeType: z.string().min(1).max(255),
        }),
      }),
      z.object({
        success: z.literal(true),
        output: z.object({
          ...quickBooksStoredFileShape,
          transactionType: documentTransactionTypeSchema,
          transactionId: boundedId,
          mimeType: z.literal('application/pdf'),
        }),
      }),
      routeErrorSchema,
    ]),
  },
})

export const quickBooksAddAttachmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/add-attachment',
  body: quickBooksAddAttachmentBodySchema,
  response: {
    mode: 'json',
    schema: z.union([
      z.object({
        success: z.literal(true),
        output: z.object({
          attachment: attachableSchema,
          attachmentId: boundedId,
          attachmentKind: z.enum(['file', 'note']),
          targetType: attachmentTargetTypeSchema,
          targetId: boundedId,
          time: z.string().nullable(),
        }),
      }),
      routeErrorSchema,
    ]),
  },
})

const QUICKBOOKS_MAX_LINES = 100
const QUICKBOOKS_MAX_ALLOCATIONS = 100

function requiredQuickBooksId(label: string) {
  return z.string().min(1, `${label} is required`).max(256, `${label} is too long`)
}

function optionalQuickBooksId(label: string) {
  return z.string().max(256, `${label} is too long`).optional()
}

function optionalQuickBooksText(label: string, max: number) {
  return z.string().max(max, `${label} is too long`).optional()
}

/**
 * QuickBooks dates are `YYYY-MM-DD`, but the format check stays in
 * `validateQuickBooksDate` so an empty value keeps meaning "not supplied".
 */
function optionalQuickBooksDate(label: string) {
  return z.string().max(32, `${label} is too long`).optional()
}

const quickBooksActiveStatusSchema = z
  .enum(['unchanged', 'active', 'inactive'], {
    error: 'activeStatus must be unchanged, active, or inactive',
  })
  .optional()

/**
 * Address input reaches this boundary already parsed into an object on every
 * caller path. Key names and their QuickBooks mapping stay in
 * `parseQuickBooksAddress`.
 */
const quickBooksAddressInputSchema = z.record(z.string(), z.string())

const quickBooksSalesLineInputSchema = z.strictObject({
  lineType: z.enum(['item', 'description'], {
    error: 'lines[].lineType must be item or description',
  }),
  amount: z.number().optional(),
  itemId: optionalQuickBooksId('lines[].itemId'),
  description: optionalQuickBooksText('lines[].description', 4000),
  quantity: z.number().optional(),
  unitPrice: z.number().optional(),
  serviceDate: optionalQuickBooksDate('lines[].serviceDate'),
})

const quickBooksSalesLinesSchema = z
  .array(quickBooksSalesLineInputSchema)
  .min(1, 'lines must contain at least one line')
  .max(QUICKBOOKS_MAX_LINES, `lines cannot contain more than ${QUICKBOOKS_MAX_LINES} lines`)

const quickBooksInvoiceAllocationsSchema = z
  .array(
    z.strictObject({
      invoiceId: requiredQuickBooksId('invoiceAllocations[].invoiceId'),
      amount: z.number(),
    })
  )
  .min(1, 'invoiceAllocations must contain at least one allocation')
  .max(
    QUICKBOOKS_MAX_ALLOCATIONS,
    `invoiceAllocations cannot contain more than ${QUICKBOOKS_MAX_ALLOCATIONS} allocations`
  )

const quickBooksBillAllocationsSchema = z
  .array(
    z.strictObject({
      billId: requiredQuickBooksId('billAllocations[].billId'),
      amount: z.number(),
    })
  )
  .min(1, 'billAllocations must contain at least one allocation')
  .max(
    QUICKBOOKS_MAX_ALLOCATIONS,
    `billAllocations cannot contain more than ${QUICKBOOKS_MAX_ALLOCATIONS} allocations`
  )

/** Every QuickBooks create/update operation answers with the same mutation envelope. */
const quickBooksMutationResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    record: z
      .object({
        Id: z.string().min(1),
        SyncToken: z.string().optional(),
      })
      .passthrough(),
    recordId: boundedId,
    syncToken: z.string().min(1),
    recordVersion: z.string().min(1),
    time: z.string().nullable(),
  }),
})

const quickBooksMutationResponse = {
  mode: 'json',
  schema: quickBooksMutationResponseSchema,
} as const

export const quickBooksCreateBillPaymentBodySchema = quickBooksAuthSchema.extend({
  vendorId: requiredQuickBooksId('vendorId'),
  totalAmount: z.number(),
  paymentType: z.enum(['check', 'credit_card'], {
    error: 'paymentType must be check or credit_card',
  }),
  paymentAccountId: requiredQuickBooksId('paymentAccountId'),
  billAllocations: quickBooksBillAllocationsSchema.optional(),
  transactionDate: optionalQuickBooksDate('transactionDate'),
  apAccountId: optionalQuickBooksId('apAccountId'),
  currencyCode: optionalQuickBooksText('currencyCode', 8),
  documentNumber: optionalQuickBooksText('documentNumber', 256),
  privateNote: optionalQuickBooksText('privateNote', 4000),
  requestId: optionalQuickBooksText('requestId', 256),
})

export const quickBooksUpdateBillBodySchema = quickBooksAuthSchema.extend({
  billId: requiredQuickBooksId('billId'),
  syncToken: requiredQuickBooksId('syncToken'),
  vendorId: optionalQuickBooksId('vendorId'),
  apAccountId: optionalQuickBooksId('apAccountId'),
  transactionDate: optionalQuickBooksDate('transactionDate'),
  dueDate: optionalQuickBooksDate('dueDate'),
  documentNumber: optionalQuickBooksText('documentNumber', 256),
  privateNote: optionalQuickBooksText('privateNote', 4000),
})

export const quickBooksUpdateBillPaymentBodySchema = quickBooksAuthSchema.extend({
  billPaymentId: requiredQuickBooksId('billPaymentId'),
  syncToken: requiredQuickBooksId('syncToken'),
  vendorId: optionalQuickBooksId('vendorId'),
  transactionDate: optionalQuickBooksDate('transactionDate'),
  privateNote: optionalQuickBooksText('privateNote', 4000),
})

/** Credit memos and refund receipts share Intuit's sales-document update shape. */
export const quickBooksUpdateSalesDocumentBodySchema = quickBooksAuthSchema.extend({
  transactionId: requiredQuickBooksId('transactionId'),
  syncToken: requiredQuickBooksId('syncToken'),
  customerId: optionalQuickBooksId('customerId'),
  lines: quickBooksSalesLinesSchema.optional(),
  transactionDate: optionalQuickBooksDate('transactionDate'),
  documentNumber: optionalQuickBooksText('documentNumber', 256),
  privateNote: optionalQuickBooksText('privateNote', 4000),
  customerMemo: optionalQuickBooksText('customerMemo', 4000),
  dueDate: optionalQuickBooksDate('dueDate'),
  expirationDate: optionalQuickBooksDate('expirationDate'),
  paymentMethodId: optionalQuickBooksId('paymentMethodId'),
  paymentReferenceNumber: optionalQuickBooksText('paymentReferenceNumber', 256),
  depositAccountId: optionalQuickBooksId('depositAccountId'),
})

export const quickBooksUpdateCustomerPaymentBodySchema = quickBooksAuthSchema.extend({
  paymentId: requiredQuickBooksId('paymentId'),
  syncToken: requiredQuickBooksId('syncToken'),
  customerId: optionalQuickBooksId('customerId'),
  totalAmount: z.number().optional(),
  transactionDate: optionalQuickBooksDate('transactionDate'),
  privateNote: optionalQuickBooksText('privateNote', 4000),
  paymentReferenceNumber: optionalQuickBooksText('paymentReferenceNumber', 256),
  paymentMethodId: optionalQuickBooksId('paymentMethodId'),
  depositAccountId: optionalQuickBooksId('depositAccountId'),
  invoiceAllocations: quickBooksInvoiceAllocationsSchema.optional(),
  unapplyOmittedInvoices: z.boolean().optional(),
})

export const quickBooksUpdateEmployeeBodySchema = quickBooksAuthSchema.extend({
  employeeId: requiredQuickBooksId('employeeId'),
  syncToken: requiredQuickBooksId('syncToken'),
  displayName: optionalQuickBooksText('displayName', 1000),
  givenName: optionalQuickBooksText('givenName', 1000),
  familyName: optionalQuickBooksText('familyName', 1000),
  primaryEmail: optionalQuickBooksText('primaryEmail', 320),
  primaryPhone: optionalQuickBooksText('primaryPhone', 100),
  primaryAddress: quickBooksAddressInputSchema.optional(),
  printOnCheckName: optionalQuickBooksText('printOnCheckName', 1000),
  billableTime: z.boolean().optional(),
  activeStatus: quickBooksActiveStatusSchema,
})

export const quickBooksUpdateItemBodySchema = quickBooksAuthSchema.extend({
  itemId: requiredQuickBooksId('itemId'),
  syncToken: requiredQuickBooksId('syncToken'),
  name: optionalQuickBooksText('name', 1000),
  incomeAccountId: optionalQuickBooksId('incomeAccountId'),
  description: optionalQuickBooksText('description', 4000),
  unitPrice: z.number().optional(),
  purchaseDescription: optionalQuickBooksText('purchaseDescription', 4000),
  purchaseCost: z.number().optional(),
  expenseAccountId: optionalQuickBooksId('expenseAccountId'),
  taxable: z.boolean().optional(),
  activeStatus: quickBooksActiveStatusSchema,
})

export const quickBooksUpdatePurchaseBodySchema = quickBooksAuthSchema.extend({
  purchaseId: requiredQuickBooksId('purchaseId'),
  syncToken: requiredQuickBooksId('syncToken'),
  vendorId: optionalQuickBooksId('vendorId'),
  transactionDate: optionalQuickBooksDate('transactionDate'),
  paymentReference: optionalQuickBooksText('paymentReference', 256),
  privateNote: optionalQuickBooksText('privateNote', 4000),
})

export const quickBooksUpdatePurchaseOrderBodySchema = quickBooksAuthSchema.extend({
  purchaseOrderId: requiredQuickBooksId('purchaseOrderId'),
  syncToken: requiredQuickBooksId('syncToken'),
  vendorId: optionalQuickBooksId('vendorId'),
  apAccountId: optionalQuickBooksId('apAccountId'),
  transactionDate: optionalQuickBooksDate('transactionDate'),
  dueDate: optionalQuickBooksDate('dueDate'),
  documentNumber: optionalQuickBooksText('documentNumber', 256),
  privateNote: optionalQuickBooksText('privateNote', 4000),
})

export const quickBooksUpdateVendorBodySchema = quickBooksAuthSchema.extend({
  vendorId: requiredQuickBooksId('vendorId'),
  syncToken: requiredQuickBooksId('syncToken'),
  displayName: optionalQuickBooksText('displayName', 1000),
  companyName: optionalQuickBooksText('companyName', 1000),
  givenName: optionalQuickBooksText('givenName', 1000),
  familyName: optionalQuickBooksText('familyName', 1000),
  primaryEmail: optionalQuickBooksText('primaryEmail', 320),
  primaryPhone: optionalQuickBooksText('primaryPhone', 100),
  billingAddress: quickBooksAddressInputSchema.optional(),
  printOnCheckName: optionalQuickBooksText('printOnCheckName', 1000),
  accountNumber: optionalQuickBooksText('accountNumber', 256),
  vendor1099: z.boolean().optional(),
  activeStatus: quickBooksActiveStatusSchema,
})

export const quickBooksUpdateVendorCreditBodySchema = quickBooksAuthSchema.extend({
  vendorCreditId: requiredQuickBooksId('vendorCreditId'),
  syncToken: requiredQuickBooksId('syncToken'),
  vendorId: optionalQuickBooksId('vendorId'),
  apAccountId: optionalQuickBooksId('apAccountId'),
  transactionDate: optionalQuickBooksDate('transactionDate'),
  documentNumber: optionalQuickBooksText('documentNumber', 256),
  privateNote: optionalQuickBooksText('privateNote', 4000),
})

export const quickBooksCreateBillPaymentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/create-bill-payment',
  body: quickBooksCreateBillPaymentBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdateBillContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-bill',
  body: quickBooksUpdateBillBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdateBillPaymentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-bill-payment',
  body: quickBooksUpdateBillPaymentBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdateCreditMemoContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-credit-memo',
  body: quickBooksUpdateSalesDocumentBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdateCustomerPaymentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-customer-payment',
  body: quickBooksUpdateCustomerPaymentBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdateEmployeeContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-employee',
  body: quickBooksUpdateEmployeeBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdateItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-item',
  body: quickBooksUpdateItemBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdatePurchaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-purchase',
  body: quickBooksUpdatePurchaseBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdatePurchaseOrderContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-purchase-order',
  body: quickBooksUpdatePurchaseOrderBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdateRefundReceiptContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-refund-receipt',
  body: quickBooksUpdateSalesDocumentBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdateVendorContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-vendor',
  body: quickBooksUpdateVendorBodySchema,
  response: quickBooksMutationResponse,
})

export const quickBooksUpdateVendorCreditContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/update-vendor-credit',
  body: quickBooksUpdateVendorCreditBodySchema,
  response: quickBooksMutationResponse,
})

export type QuickBooksCreateBillPaymentBody = ContractBody<
  typeof quickBooksCreateBillPaymentContract
>
export type QuickBooksUpdateBillBody = ContractBody<typeof quickBooksUpdateBillContract>
export type QuickBooksUpdateBillPaymentBody = ContractBody<
  typeof quickBooksUpdateBillPaymentContract
>
export type QuickBooksUpdateCreditMemoBody = ContractBody<typeof quickBooksUpdateCreditMemoContract>
export type QuickBooksUpdateCustomerPaymentBody = ContractBody<
  typeof quickBooksUpdateCustomerPaymentContract
>
export type QuickBooksUpdateEmployeeBody = ContractBody<typeof quickBooksUpdateEmployeeContract>
export type QuickBooksUpdateItemBody = ContractBody<typeof quickBooksUpdateItemContract>
export type QuickBooksUpdatePurchaseBody = ContractBody<typeof quickBooksUpdatePurchaseContract>
export type QuickBooksUpdatePurchaseOrderBody = ContractBody<
  typeof quickBooksUpdatePurchaseOrderContract
>
export type QuickBooksUpdateRefundReceiptBody = ContractBody<
  typeof quickBooksUpdateRefundReceiptContract
>
export type QuickBooksUpdateVendorBody = ContractBody<typeof quickBooksUpdateVendorContract>
export type QuickBooksUpdateVendorCreditBody = ContractBody<
  typeof quickBooksUpdateVendorCreditContract
>
export type QuickBooksMutationOperationResponse = ContractJsonResponse<
  typeof quickBooksUpdateVendorContract
>
