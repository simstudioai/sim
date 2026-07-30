import { z } from 'zod'
import type { ContractBody, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const quickBooksUploadAttachmentBodySchema = z.object({
  accessToken: z
    .string()
    .min(1, 'Access token is required')
    .max(4096, 'Access token must be 4096 characters or less')
    .regex(/^[^\r\n]+$/, 'Access token contains invalid characters')
    .refine((value) => value.trim().length > 0, 'Access token is required'),
  realmId: z
    .string()
    .min(1, 'QuickBooks company ID is required')
    .max(64, 'QuickBooks company ID must be 64 characters or less')
    .regex(/^\d+$/, 'QuickBooks company ID must contain only digits'),
  file: RawFileInputSchema,
  entity: z
    .string()
    .min(1, 'QuickBooks entity type is required')
    .max(100, 'QuickBooks entity type must be 100 characters or less')
    .regex(/^[A-Za-z][A-Za-z0-9]*$/, 'QuickBooks entity type is invalid'),
  entityId: z
    .string()
    .min(1, 'QuickBooks entity ID is required')
    .max(255, 'QuickBooks entity ID must be 255 characters or less'),
  note: z.string().max(2000, 'Attachment note must be 2000 characters or less').optional(),
  includeOnSend: z.boolean().optional(),
  apiEnvironment: z.enum(['production', 'sandbox']).optional(),
  minorVersion: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value
      const trimmed = value.trim()
      return trimmed || undefined
    },
    z
      .string()
      .regex(/^\d{1,5}$/, 'Minor version must contain one to five digits')
      .optional()
  ),
})

const quickBooksUploadAttachmentResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    output: z.object({
      result: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
])

export const quickBooksUploadAttachmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quickbooks/upload-attachment',
  body: quickBooksUploadAttachmentBodySchema,
  response: { mode: 'json', schema: quickBooksUploadAttachmentResponseSchema },
})

export type QuickBooksUploadAttachmentBody = ContractBody<typeof quickBooksUploadAttachmentContract>
export type QuickBooksUploadAttachmentApiResponse = ContractJsonResponse<
  typeof quickBooksUploadAttachmentContract
>
