import { z } from 'zod'

export const v2UploadStatusSchema = z.enum([
  'uploading',
  'finalizing',
  'completed',
  'failed',
  'aborted',
  'expired',
])
export type V2UploadStatus = z.output<typeof v2UploadStatusSchema>

export const v2UploadTokenHeadersSchema = z.object({
  'upload-token': z.string().min(1, 'upload-token header is required'),
})
export type V2UploadTokenHeaders = z.input<typeof v2UploadTokenHeadersSchema>

export const v2OptionalUploadTokenHeadersSchema = z.object({
  'upload-token': z.string().min(1, 'upload-token header cannot be empty').optional(),
})

export const v2CompletedPartSchema = z
  .object({
    partNumber: z.number().int().min(1),
    etag: z.string().min(1).optional(),
  })
  .strict()
export type V2CompletedPart = z.input<typeof v2CompletedPartSchema>

const v2CompleteMultipartUploadBodySchema = z
  .object({
    parts: z.array(v2CompletedPartSchema).min(1).max(640),
  })
  .strict()

const v2CompletePutUploadBodySchema = z.object({}).strict()

export const v2CompleteUploadBodySchema = z.union([
  v2CompleteMultipartUploadBodySchema,
  v2CompletePutUploadBodySchema,
])
export type V2CompleteUploadBody = z.input<typeof v2CompleteUploadBodySchema>

export const v2PutUploadTransferSchema = z
  .object({
    method: z.literal('put'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()),
  })
  .strict()
export type V2PutUploadTransfer = z.output<typeof v2PutUploadTransferSchema>

export const v2MultipartUploadTransferSchema = z
  .object({
    method: z.literal('multipart'),
    partSize: z.number().int().positive(),
    partCount: z.number().int().positive().max(640),
  })
  .strict()
export type V2MultipartUploadTransfer = z.output<typeof v2MultipartUploadTransferSchema>

export const v2UploadTransferSchema = z.discriminatedUnion('method', [
  v2PutUploadTransferSchema,
  v2MultipartUploadTransferSchema,
])
export type V2UploadTransfer = z.output<typeof v2UploadTransferSchema>

export const v2PartUrlsBodySchema = z
  .object({
    partNumbers: z.array(z.number().int().min(1)).min(1).max(100),
  })
  .strict()
export type V2PartUrlsBody = z.input<typeof v2PartUrlsBodySchema>

export const v2UploadPartUrlSchema = z.object({
  partNumber: z.number().int().min(1),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime(),
})
export type V2UploadPartUrl = z.output<typeof v2UploadPartUrlSchema>

export const v2PartUrlsDataSchema = z.object({ parts: z.array(v2UploadPartUrlSchema).max(100) })
export type V2PartUrlsData = z.output<typeof v2PartUrlsDataSchema>
