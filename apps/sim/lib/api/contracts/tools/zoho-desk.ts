import { z } from 'zod'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const zohoAccessTokenSchema = z.string().min(1, 'Access token is required')
const zohoApiDomainSchema = z.string().optional().nullable()
const zohoOrgIdSchema = z.string().min(1, 'Organization ID is required')

export const zohoDeskGetAttachmentBodySchema = z.object({
  accessToken: zohoAccessTokenSchema,
  apiDomain: zohoApiDomainSchema,
  orgId: zohoOrgIdSchema,
  // The documented download reference from an attachment object (thread/comment
  // attachments expose `href`). Absolute Zoho URLs are used as-is; a relative
  // path is resolved against the Desk API base.
  href: z.string().min(1, 'Attachment href is required'),
  fileName: z.string().optional().nullable(),
})

const zohoDeskFileSchema = z.object({
  data: z.string(),
  mimeType: z.string(),
  // FileToolProcessor (ToolFileData) reads the file name from `name`.
  name: z.string(),
})

export const zohoDeskGetAttachmentResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({ file: zohoDeskFileSchema }).optional(),
  error: z.string().optional(),
})

export const zohoDeskGetAttachmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/zoho_desk/attachment',
  body: zohoDeskGetAttachmentBodySchema,
  response: { mode: 'json', schema: zohoDeskGetAttachmentResponseSchema },
})

export type ZohoDeskGetAttachmentBody = ContractBodyInput<typeof zohoDeskGetAttachmentContract>
export type ZohoDeskGetAttachmentResponse = ContractJsonResponse<
  typeof zohoDeskGetAttachmentContract
>
