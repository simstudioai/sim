import { z } from 'zod'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const brexUploadReceiptBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  expenseId: z.string().trim().min(1, 'Expense ID cannot be empty').optional(),
  file: RawFileInputSchema,
  receiptName: z
    .string()
    .min(1, 'Receipt name cannot be empty')
    .max(255, 'Receipt name must be at most 255 characters')
    .optional(),
})

export const brexUploadReceiptResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    receiptId: z.string(),
    receiptName: z.string(),
    expenseId: z.string().nullable(),
  }),
})

export const brexUploadReceiptContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/brex/upload-receipt',
  body: brexUploadReceiptBodySchema,
  response: { mode: 'json', schema: brexUploadReceiptResponseSchema },
})

export type BrexUploadReceiptBody = ContractBodyInput<typeof brexUploadReceiptContract>
export type BrexUploadReceiptRouteResponse = ContractJsonResponse<typeof brexUploadReceiptContract>
