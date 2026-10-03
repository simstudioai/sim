import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const MAX_ACCESS_TOKEN_LENGTH = 8192
const MAX_GRAPH_ID_LENGTH = 256

const accessTokenSchema = z
  .string()
  .min(1, 'Access token is required')
  .max(MAX_ACCESS_TOKEN_LENGTH, 'Access token is too long')

const phoneNumberIdSchema = z
  .string()
  .trim()
  .min(1, 'Phone Number ID is required')
  .max(MAX_GRAPH_ID_LENGTH, 'Phone Number ID is too long')

const mediaIdSchema = z
  .string()
  .trim()
  .min(1, 'Media ID is required')
  .max(MAX_GRAPH_ID_LENGTH, 'Media ID is too long')

export const whatsappUploadMediaInputSchema = z.object({
  accessToken: accessTokenSchema,
  phoneNumberId: phoneNumberIdSchema,
  file: RawFileInputSchema,
})

export const whatsappUploadMediaOutputSchema = z.object({
  mediaId: z.string().min(1).max(MAX_GRAPH_ID_LENGTH),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
})

export const whatsappSendMediaInputSchema = z.object({
  accessToken: accessTokenSchema,
  phoneNumberId: phoneNumberIdSchema,
  phoneNumber: z.string().trim().min(1, 'Recipient phone number is required').max(64),
  mediaType: z.enum(['image', 'document', 'video', 'audio', 'sticker']),
  file: RawFileInputSchema.optional().nullable(),
  mediaId: mediaIdSchema.optional().nullable(),
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
  mediaId: z.string().optional(),
})

export const whatsappGetMediaInputSchema = z.object({
  accessToken: accessTokenSchema,
  mediaId: mediaIdSchema,
  phoneNumberId: phoneNumberIdSchema.optional(),
})

export const whatsappGetMediaOutputSchema = z.object({
  file: userFileSchema,
  mediaId: z.string().min(1).max(MAX_GRAPH_ID_LENGTH),
  mimeType: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
  sha256: z.string().nullable(),
})

export type WhatsAppUploadMediaInput = z.output<typeof whatsappUploadMediaInputSchema>
export type WhatsAppSendMediaInput = z.output<typeof whatsappSendMediaInputSchema>
export type WhatsAppGetMediaInput = z.output<typeof whatsappGetMediaInputSchema>
