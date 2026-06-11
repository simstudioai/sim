import { z } from 'zod'
import { type ContractBodyInput, defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const rampUploadReceiptBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  userId: z.string().min(1, 'User ID is required'),
  transactionId: z.string().nullish(),
  file: FileInputSchema,
})

export const rampUploadReceiptResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    receiptId: z.string(),
  }),
})

export const rampUploadReceiptContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ramp/upload-receipt',
  body: rampUploadReceiptBodySchema,
  response: { mode: 'json', schema: rampUploadReceiptResponseSchema },
})

export type RampUploadReceiptBody = ContractBodyInput<typeof rampUploadReceiptContract>
