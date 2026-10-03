import { z } from 'zod'
import { v2TimestampSchema } from '@/lib/api/contracts/v2/shared'

export const v2UploadStatusSchema = z.enum([
  'uploading',
  'completing',
  'finalizing',
  'completed',
  'failed',
  'aborting',
  'aborted',
  'expired',
])
export type V2UploadStatus = z.output<typeof v2UploadStatusSchema>

export const v2UploadTokenHeadersSchema = z.object({
  'upload-token': z
    .string()
    .min(1, 'upload-token header is required')
    .describe('Signed upload control token returned when the upload session was created.'),
})
export type V2UploadTokenHeaders = z.input<typeof v2UploadTokenHeadersSchema>

export const v2OptionalUploadTokenHeadersSchema = z.object({
  'upload-token': z.string().min(1, 'upload-token header cannot be empty').optional(),
})

/**
 * What a caller needs about the transfer step, stated in the published document
 * rather than only in the source.
 *
 * The URL a transfer hands back can point at object storage or, on a
 * self-hosted deployment, at Sim's own local data plane — so the endpoint is
 * described by this field rather than by an operation of its own, and no
 * OpenAPI document declares it. That is deliberate (the URL is signed,
 * short-lived, and never constructed from docs), but it left the one step that
 * actually moves the bytes with no published status codes at all. This is that
 * contract.
 */
const TRANSFER_STEP_CONTRACT =
  'Upload bytes with `PUT` and exactly the supplied headers; never construct or modify the signed URL. Treat any `2xx` as success. Sim-hosted URLs return an empty `204` and v2 JSON errors. Object-storage URLs may return `200` or `201` and provider-specific errors, often XML.'

export const v2PutUploadTransferSchema = z
  .object({
    method: z.literal('put').describe('Upload strategy discriminator.'),
    url: z
      .string()
      .url()
      .describe(`Signed URL to which the file bytes are uploaded. ${TRANSFER_STEP_CONTRACT}`),
    headers: z
      .record(z.string(), z.string())
      .describe('Headers that must be included with the upload request.'),
    expiresAt: v2TimestampSchema.describe(
      "ISO 8601 expiration time for this signed URL. This is the URL's own expiry and is normally earlier than the upload session's expiresAt: the session stays open for later part, status, completion, and abort requests, but the bytes must be uploaded before this time. Once it passes, the storage provider rejects the upload and a new upload session must be created."
    ),
  })
  .strict()
  .meta({
    id: 'V2PutUploadTransfer',
    title: 'Direct upload transfer',
    description: 'Instructions for uploading bytes to one signed URL.',
  })
export type V2PutUploadTransfer = z.output<typeof v2PutUploadTransferSchema>

export const v2MultipartUploadTransferSchema = z
  .object({
    method: z.literal('multipart').describe('Upload strategy discriminator.'),
    partSize: z
      .number()
      .int()
      .positive()
      .describe('Required size of each non-final part in bytes.'),
    partCount: z.number().int().positive().max(640).describe('Total number of upload parts.'),
  })
  .strict()
  .meta({
    id: 'V2MultipartUploadTransfer',
    title: 'Multipart upload transfer',
    description: 'Instructions for splitting bytes into a multipart upload.',
  })
export type V2MultipartUploadTransfer = z.output<typeof v2MultipartUploadTransferSchema>

export const v2UploadTransferSchema = z.discriminatedUnion('method', [
  v2PutUploadTransferSchema,
  v2MultipartUploadTransferSchema,
])
export type V2UploadTransfer = z.output<typeof v2UploadTransferSchema>

export const v2PartUrlsBodySchema = z
  .object({
    partNumbers: z
      .array(z.number().int().min(1))
      .min(1)
      .max(100)
      .describe('Multipart part numbers for which signed URLs should be created.'),
  })
  .strict()
export type V2PartUrlsBody = z.input<typeof v2PartUrlsBodySchema>

export const v2UploadPartUrlSchema = z
  .object({
    partNumber: z.number().int().min(1).describe('Multipart part number.'),
    url: z
      .string()
      .url()
      .describe(
        `Signed URL for this upload part. ${TRANSFER_STEP_CONTRACT} Do not retain part \`ETag\` values; after every part succeeds, call the completion endpoint without a request body.`
      ),
    headers: z
      .record(z.string(), z.string())
      .describe('Headers that must be included with the part upload.'),
    expiresAt: v2TimestampSchema.describe('ISO 8601 expiration time for the signed URL.'),
  })
  .meta({
    id: 'V2UploadPartUrl',
    title: 'Upload part URL',
    description: 'A signed URL and required headers for one multipart upload part.',
  })
export type V2UploadPartUrl = z.output<typeof v2UploadPartUrlSchema>

export const v2PartUrlsDataSchema = z
  .object({
    parts: z.array(v2UploadPartUrlSchema).max(100).describe('Signed URLs for requested parts.'),
  })
  .meta({
    id: 'V2PartUrlsData',
    title: 'Upload part URLs',
    description: 'Signed transfer URLs for the requested multipart upload parts.',
  })
export type V2PartUrlsData = z.output<typeof v2PartUrlsDataSchema>
