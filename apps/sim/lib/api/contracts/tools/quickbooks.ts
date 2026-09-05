import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
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
