import { z } from 'zod'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const OCI_BUCKET_NAME_MAX_LENGTH = 256
export const OCI_OBJECT_NAME_MAX_BYTES = 1_024
export const OCI_CONTINUATION_TOKEN_MAX_LENGTH = 1_024

const OCI_BUCKET_NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const OCI_UNSAFE_OBJECT_TEXT_PATTERN = /[\u0000\r\n]/

const optionalNumberInput = (value: unknown) =>
  value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value

export function isValidOciBucketName(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= OCI_BUCKET_NAME_MAX_LENGTH &&
    OCI_BUCKET_NAME_PATTERN.test(value)
  )
}

export function isValidOciObjectText(value: string, allowEmpty = false): boolean {
  return (
    (allowEmpty || value.length > 0) &&
    Buffer.byteLength(value, 'utf8') <= OCI_OBJECT_NAME_MAX_BYTES &&
    !OCI_UNSAFE_OBJECT_TEXT_PATTERN.test(value)
  )
}

const credentialId = z.string().trim().min(1).max(255)
const bucketName = z
  .string()
  .trim()
  .min(1)
  .max(OCI_BUCKET_NAME_MAX_LENGTH)
  .refine(isValidOciBucketName, {
    message: 'Bucket name must use only letters, numbers, periods, underscores, and hyphens',
  })
const objectKey = z
  .string()
  .min(1)
  .refine((value) => isValidOciObjectText(value), {
    message: 'Object key must be at most 1024 UTF-8 bytes and cannot contain CR, LF, or NUL',
  })
const optionalObjectPrefix = z
  .string()
  .refine((value) => isValidOciObjectText(value, true), {
    message: 'Prefix must be at most 1024 UTF-8 bytes and cannot contain CR, LF, or NUL',
  })
  .optional()

const baseInput = { credentialId }
const objectInput = { ...baseInput, bucketName, objectKey }

export const ociObjectStorageListBucketsInputSchema = z.object(baseInput).strict()

export const ociObjectStorageListObjectsInputSchema = z
  .object({
    ...baseInput,
    bucketName,
    prefix: optionalObjectPrefix,
    delimiter: z.literal('/').optional(),
    maxKeys: z.preprocess(
      optionalNumberInput,
      z.coerce.number().int().min(1).max(1_000).default(100)
    ),
    startAfter: objectKey.optional(),
    continuationToken: z.string().min(1).max(OCI_CONTINUATION_TOKEN_MAX_LENGTH).optional(),
  })
  .strict()

export const ociObjectStorageUploadObjectInputSchema = z
  .object({
    ...objectInput,
    file: RawFileInputSchema.optional().nullable(),
    content: z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_BUFFERED_TRANSFER_BYTES, {
        message: 'Inline content exceeds the 100 MiB transfer limit',
      })
      .optional()
      .nullable(),
    contentType: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const sources =
      Number(Boolean(value.file)) + Number(value.content !== undefined && value.content !== null)
    if (sources !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one upload source: file or inline content',
        path: ['file'],
      })
    }
  })

export const ociObjectStorageDownloadObjectInputSchema = z.object(objectInput).strict()
export const ociObjectStorageHeadObjectInputSchema = z.object(objectInput).strict()
export const ociObjectStorageDeleteObjectInputSchema = z.object(objectInput).strict()

export type OciObjectStorageListBucketsInput = z.output<
  typeof ociObjectStorageListBucketsInputSchema
>
export type OciObjectStorageListObjectsInput = z.output<
  typeof ociObjectStorageListObjectsInputSchema
>
export type OciObjectStorageUploadObjectInput = z.output<
  typeof ociObjectStorageUploadObjectInputSchema
>
export type OciObjectStorageDownloadObjectInput = z.output<
  typeof ociObjectStorageDownloadObjectInputSchema
>
export type OciObjectStorageHeadObjectInput = z.output<typeof ociObjectStorageHeadObjectInputSchema>
export type OciObjectStorageDeleteObjectInput = z.output<
  typeof ociObjectStorageDeleteObjectInputSchema
>
