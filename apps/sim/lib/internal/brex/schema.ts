import { z } from 'zod'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const apiKeySchema = z
  .string()
  .min(1, 'API key is required')
  .max(512, 'API key is too long')
  .regex(/^[\x21-\x7e]+$/, 'API key contains invalid characters')

const receiptNameSchema = z
  .string()
  .trim()
  .min(1, 'Receipt name cannot be empty')
  .max(255, 'Receipt name must be at most 255 characters')
  .optional()

const receiptInputShape = {
  apiKey: apiKeySchema,
  file: RawFileInputSchema,
  receiptName: receiptNameSchema,
}

export const brexMatchReceiptInputSchema = z.object(receiptInputShape)

export const brexUploadReceiptInputSchema = z.object({
  ...receiptInputShape,
  expenseId: z
    .string()
    .trim()
    .min(1, 'Expense ID cannot be empty')
    .max(255, 'Expense ID must be at most 255 characters'),
})

export type BrexMatchReceiptInput = z.output<typeof brexMatchReceiptInputSchema>
export type BrexUploadReceiptInput = z.output<typeof brexUploadReceiptInputSchema>
