import { z } from 'zod'
import {
  nonEmptyIdSchema,
  userFileSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const MAX_ACCESS_TOKEN_LENGTH = 8192
const MAX_GRAPH_ID_LENGTH = 256

const whatsappAccessTokenSchema = z
  .string()
  .min(1, 'Access token is required')
  .max(MAX_ACCESS_TOKEN_LENGTH, 'Access token is too long')

const whatsappPhoneNumberIdSchema = z
  .string()
  .trim()
  .min(1, 'Phone Number ID is required')
  .max(MAX_GRAPH_ID_LENGTH, 'Phone Number ID is too long')

const whatsappMediaIdSchema = z
  .string()
  .trim()
  .min(1, 'Media ID is required')
  .max(MAX_GRAPH_ID_LENGTH, 'Media ID is too long')

const executionContextShape = {
  workspaceId: workspaceIdSchema.optional(),
  workflowId: workflowIdSchema.optional(),
  executionId: nonEmptyIdSchema.optional(),
}

export const whatsappUploadMediaBodySchema = z.object({
  accessToken: whatsappAccessTokenSchema,
  phoneNumberId: whatsappPhoneNumberIdSchema,
  file: RawFileInputSchema,
})

export const whatsappUploadMediaOutputSchema = z.object({
  mediaId: z.string().min(1).max(MAX_GRAPH_ID_LENGTH),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
})

export const whatsappSendMediaBodySchema = z.object({
  accessToken: whatsappAccessTokenSchema,
  phoneNumberId: whatsappPhoneNumberIdSchema,
  phoneNumber: z.string().trim().min(1, 'Recipient phone number is required').max(64),
  mediaType: z.enum(['image', 'document', 'video', 'audio', 'sticker']),
  /** Exactly one of file, mediaId, or mediaLink must be supplied. */
  file: RawFileInputSchema.optional().nullable(),
  mediaId: whatsappMediaIdSchema.optional().nullable(),
  mediaLink: z.string().trim().max(8192).optional().nullable(),
  caption: z.string().max(1024, 'Caption cannot exceed 1024 characters').optional().nullable(),
  filename: z.string().max(1024).optional().nullable(),
})

export const whatsappSendMediaOutputSchema = z.object({
  success: z.literal(true),
  messageId: z.string().min(1),
  messageStatus: z.string().optional(),
  messagingProduct: z.string().optional(),
  inputPhoneNumber: z.string().nullable(),
  whatsappUserId: z.string().nullable(),
  contacts: z.array(z.object({ input: z.string(), wa_id: z.string().nullable() })),
  /** Set only when a file was uploaded as part of this send. */
  mediaId: z.string().optional(),
})

export const whatsappGetMediaBodySchema = z.object({
  accessToken: whatsappAccessTokenSchema,
  mediaId: whatsappMediaIdSchema,
  /** Optional ownership scoping check accepted by `GET /{media-id}`. */
  phoneNumberId: whatsappPhoneNumberIdSchema.optional(),
  ...executionContextShape,
})

export const whatsappGetMediaOutputSchema = z.object({
  file: userFileSchema,
  mediaId: z.string().min(1).max(MAX_GRAPH_ID_LENGTH),
  mimeType: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
  sha256: z.string().nullable(),
})

const whatsappRouteResponseSchema = <TOutput extends z.ZodType>(output: TOutput) =>
  z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), output }),
    z.object({ success: z.literal(false), error: z.string().min(1) }),
  ])

export const whatsappUploadMediaResponseSchema = whatsappRouteResponseSchema(
  whatsappUploadMediaOutputSchema
)
export const whatsappSendMediaResponseSchema = whatsappRouteResponseSchema(
  whatsappSendMediaOutputSchema
)
export const whatsappGetMediaResponseSchema = whatsappRouteResponseSchema(
  whatsappGetMediaOutputSchema
)

export const whatsappUploadMediaContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/whatsapp/upload-media',
  body: whatsappUploadMediaBodySchema,
  response: { mode: 'json', schema: whatsappUploadMediaResponseSchema },
})

export const whatsappSendMediaContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/whatsapp/send-media',
  body: whatsappSendMediaBodySchema,
  response: { mode: 'json', schema: whatsappSendMediaResponseSchema },
})

export const whatsappGetMediaContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/whatsapp/get-media',
  body: whatsappGetMediaBodySchema,
  response: { mode: 'json', schema: whatsappGetMediaResponseSchema },
})

export type WhatsAppUploadMediaBody = ContractBodyInput<typeof whatsappUploadMediaContract>
export type WhatsAppSendMediaBody = ContractBodyInput<typeof whatsappSendMediaContract>
export type WhatsAppGetMediaBody = ContractBodyInput<typeof whatsappGetMediaContract>
export type WhatsAppUploadMediaRouteResponse = ContractJsonResponse<
  typeof whatsappUploadMediaContract
>
export type WhatsAppSendMediaRouteResponse = ContractJsonResponse<typeof whatsappSendMediaContract>
export type WhatsAppGetMediaRouteResponse = ContractJsonResponse<typeof whatsappGetMediaContract>
