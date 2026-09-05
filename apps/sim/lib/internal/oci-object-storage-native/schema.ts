import { z } from 'zod'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import {
  isOciNativeJsonWithinLimit,
  OCI_NATIVE_JSON_BYTES,
} from '@/tools/oci_object_storage_native/shared'

export const OCI_NATIVE_METADATA_BYTES = 4_000

const text = z
  .string()
  .min(1)
  .max(4_096)
  .regex(/^[^\u0000-\u001f\u007f]*$/)
const pathValue = text.refine((value) => value !== '.' && value !== '..', {
  message: 'A complete path parameter cannot be . or ..',
})
const objectName = pathValue.refine((value) => Buffer.byteLength(value, 'utf8') <= 1_024, {
  message: 'Object names must fit within 1024 UTF-8 bytes',
})
const prefix = z
  .string()
  .max(1_024)
  .regex(/^[^\u0000-\u001f\u007f]*$/)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 1_024,
    'Prefix must fit within 1024 UTF-8 bytes'
  )
const bucketName = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => value !== '.' && value !== '..')
const optionalNumber = (value: unknown) => (value === null || value === '' ? undefined : value)
const number = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum)
const limit = z.preprocess(optionalNumber, number(1, 1_000).default(100))
const tier = z.enum(['Standard', 'InfrequentAccess', 'Archive'])

/** Accept the resolved JSON editor value or a structured tool argument, with a byte bound. */
const jsonInput = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value, ctx) => {
    if (typeof value !== 'string') {
      try {
        if (isOciNativeJsonWithinLimit(value, OCI_NATIVE_JSON_BYTES)) return value
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid or excessively nested JSON input',
        })
        return z.NEVER
      }
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON input exceeds 8 MiB' })
      return z.NEVER
    }
    if (Buffer.byteLength(value, 'utf8') > OCI_NATIVE_JSON_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON input exceeds 8 MiB' })
      return z.NEVER
    }
    try {
      const parsed: unknown = JSON.parse(value)
      if (!isOciNativeJsonWithinLimit(parsed, OCI_NATIVE_JSON_BYTES)) throw new Error('JSON limit')
      return parsed
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JSON input' })
      return z.NEVER
    }
  }, schema)

const metadata = jsonInput(
  z.record(z.string(), z.string()).superRefine((value, ctx) => {
    let bytes = 0
    const names = new Set<string>()
    for (const [key, content] of Object.entries(value)) {
      const name = `opc-meta-${key}`.toLowerCase()
      bytes += Buffer.byteLength(name, 'utf8') + Buffer.byteLength(content, 'utf8')
      if (
        !/^[A-Za-z0-9_-]+$/.test(key) ||
        /[\u0000-\u001f\u007f]/.test(content) ||
        names.has(name)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Metadata requires unique header-safe keys and values',
        })
      }
      names.add(name)
    }
    if (bytes > OCI_NATIVE_METADATA_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Custom metadata exceeds 4000 UTF-8 bytes',
      })
    }
  })
)
const tags = jsonInput(z.record(z.string(), z.string()))
const definedTags = jsonInput(z.record(z.string(), z.record(z.string(), z.unknown())))
const base = {
  credentialId: z.string().trim().min(1).max(255),
  region: text.optional(),
  namespace: pathValue.optional(),
}
const bucket = { ...base, bucketName }
const object = { ...bucket, objectName }
const conditions = { ifMatch: text.optional(), ifNoneMatch: z.literal('*').optional() }
const version = { versionId: pathValue.optional() }
const paging = { limit, page: text.optional() }
const objectListing = {
  prefix: prefix.optional(),
  start: prefix.optional(),
  end: prefix.optional(),
  startAfter: prefix.optional(),
  delimiter: z.literal('/').optional(),
  limit,
}
const upload = {
  file: RawFileInputSchema.optional().nullable(),
  content: z
    .string()
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= OCI_NATIVE_JSON_BYTES,
      'Inline content must fit within the 8 MiB JSON request limit'
    )
    .optional()
    .nullable(),
  contentType: text.optional(),
}
const contentHeaders = {
  contentType: text.optional(),
  contentLanguage: text.optional(),
  contentEncoding: text.optional(),
  contentDisposition: text.optional(),
  cacheControl: text.optional(),
}
const bucketSettings = {
  metadata: jsonInput(z.record(z.string(), z.string())).optional(),
  freeformTags: tags.optional(),
  definedTags: definedTags.optional(),
  autoTiering: z.enum(['Disabled', 'InfrequentAccess']).optional(),
  objectEventsEnabled: z.boolean().optional(),
}
const partNumber = number(1, 10_000)
const multipart = { ...object, uploadId: pathValue }
const rule = z
  .object({
    name: text,
    action: z.enum(['ARCHIVE', 'INFREQUENT_ACCESS', 'DELETE', 'ABORT']),
    timeAmount: z.number().int().min(1),
    timeUnit: z.enum(['DAYS', 'YEARS']),
    isEnabled: z.boolean(),
    target: z.enum(['objects', 'previous-object-versions', 'multipart-uploads']).optional(),
    objectNameFilter: z
      .object({
        inclusionPrefixes: z.array(prefix).max(1_000).optional(),
        inclusionPatterns: z.array(text).max(20).optional(),
        exclusionPatterns: z.array(text).max(20).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.action === 'ABORT') !== (value.target === 'multipart-uploads')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ABORT rules require the multipart-uploads target, and only ABORT can target it',
      })
    }
  })
const input = <T extends string, S extends z.ZodRawShape>(operation: T, shape: S) =>
  z.object({ operation: z.literal(operation), ...shape }).strict()

export const ociNativeInputSchema = z
  .discriminatedUnion('operation', [
    input('get_namespace', { ...base, compartmentId: text.optional() }),
    input('list_buckets', { ...base, compartmentId: text, ...paging }),
    input('get_bucket', { ...bucket, ifMatch: text.optional() }),
    input('create_bucket', {
      ...bucket,
      compartmentId: text,
      ...bucketSettings,
      storageTier: z.enum(['Standard', 'Archive']).default('Standard'),
      versioning: z.enum(['Enabled', 'Disabled']).default('Disabled'),
    }),
    input('update_bucket', {
      ...bucket,
      ...bucketSettings,
      ifMatch: text.optional(),
      versioning: z.enum(['Enabled', 'Suspended']).optional(),
    }),
    input('delete_bucket', { ...bucket, ifMatch: text.optional() }),
    input('list_objects', { ...bucket, ...objectListing }),
    input('head_object', { ...object, ...version, ifMatch: text.optional() }),
    input('upload_object', {
      ...object,
      ...upload,
      ...contentHeaders,
      ...conditions,
      metadata: metadata.optional(),
      storageTier: tier.optional(),
      contentMd5: text.optional(),
    }),
    input('download_object', { ...object, ...version, ifMatch: text.optional() }),
    input('copy_object', {
      ...object,
      destinationRegion: text,
      destinationNamespace: pathValue,
      destinationBucket: bucketName,
      destinationObjectName: objectName,
      sourceVersionId: pathValue.optional(),
      sourceObjectIfMatchETag: text.optional(),
      destinationObjectIfMatchETag: text.optional(),
      destinationObjectIfNoneMatchETag: z.literal('*').optional(),
      destinationObjectMetadata: metadata.optional(),
      destinationObjectStorageTier: tier.optional(),
    }),
    input('rename_object', {
      ...object,
      newName: objectName,
      srcObjIfMatchETag: text.optional(),
      newObjIfMatchETag: text.optional(),
      newObjIfNoneMatchETag: z.literal('*').optional(),
    }),
    input('delete_object', { ...object, ...version, ifMatch: text.optional() }),
    input('batch_delete_objects', {
      ...bucket,
      objects: jsonInput(
        z
          .array(
            z
              .object({
                objectName,
                ifMatch: text.max(64).optional(),
              })
              .strict()
          )
          .min(1)
          .max(1_000)
      ),
      isSkipDeletedResult: z.boolean().default(false),
    }),
    input('list_object_versions', { ...bucket, ...objectListing, page: text.optional() }),
    input('restore_object', {
      ...object,
      ...version,
      hours: z.preprocess(optionalNumber, number(1, 240).default(24)),
    }),
    input('update_object_storage_tier', { ...object, ...version, storageTier: tier }),
    input('get_lifecycle_policy', bucket),
    input('put_lifecycle_policy', {
      ...bucket,
      ...conditions,
      rules: jsonInput(z.array(rule).max(1_000)),
    }),
    input('delete_lifecycle_policy', { ...bucket, ifMatch: text.optional() }),
    input('create_multipart_upload', {
      ...object,
      ...contentHeaders,
      ...conditions,
      metadata: metadata.optional(),
      storageTier: tier.optional(),
    }),
    input('upload_part', {
      ...multipart,
      ...upload,
      ...conditions,
      partNumber,
      contentMd5: text.optional(),
    }),
    input('list_multipart_uploads', { ...bucket, ...paging }),
    input('list_multipart_parts', { ...multipart, ...paging }),
    input('commit_multipart_upload', {
      ...multipart,
      ...conditions,
      partsToCommit: jsonInput(
        z
          .array(z.object({ partNum: z.number().int().min(1).max(10_000), etag: text }).strict())
          .min(1)
          .max(10_000)
      ),
      partsToExclude: jsonInput(
        z.array(z.number().int().min(1).max(10_000)).max(10_000)
      ).optional(),
    }),
    input('abort_multipart_upload', multipart),
    input('create_preauthenticated_request', {
      ...bucket,
      name: text,
      scope: z.enum(['object', 'prefix', 'bucket']),
      accessType: z.enum([
        'ObjectRead',
        'ObjectWrite',
        'ObjectReadWrite',
        'AnyObjectRead',
        'AnyObjectWrite',
        'AnyObjectReadWrite',
      ]),
      objectName: objectName.optional(),
      timeExpires: z.string().datetime({ offset: true }),
      bucketListingAction: z.enum(['Deny', 'ListObjects']).default('Deny'),
    }),
    input('list_preauthenticated_requests', {
      ...bucket,
      ...paging,
      objectNamePrefix: prefix.optional(),
    }),
    input('get_preauthenticated_request', { ...bucket, parId: pathValue }),
    input('delete_preauthenticated_request', { ...bucket, parId: pathValue }),
    input('get_work_request', { ...base, workRequestId: pathValue }),
  ])
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    if (value.operation === 'upload_object' || value.operation === 'upload_part') {
      if (Number(value.file != null) + Number(value.content != null) !== 1)
        issue('Provide exactly one of file or content; empty text is supported')
    }
    if (value.operation === 'commit_multipart_upload') {
      const committed = new Set(value.partsToCommit.map((part) => part.partNum))
      const excluded = value.partsToExclude ?? []
      if (
        committed.size !== value.partsToCommit.length ||
        new Set(excluded).size !== excluded.length ||
        excluded.some((part) => committed.has(part))
      ) {
        issue(
          'Multipart manifests require unique, non-overlapping committed and excluded part numbers'
        )
      }
    }
    if (value.operation === 'create_preauthenticated_request') {
      if (Date.parse(value.timeExpires) <= Date.now())
        issue('Pre-authenticated requests require a future expiry')
      if (value.scope === 'bucket' ? value.objectName !== undefined : !value.objectName)
        issue(
          'Provide an object name for object scope or a prefix for prefix scope; omit it for bucket scope'
        )
      if ((value.scope === 'object') !== value.accessType.startsWith('Object'))
        issue(
          'Object scope requires Object access types; prefix and bucket scopes require AnyObject access types'
        )
      if (
        value.bucketListingAction === 'ListObjects' &&
        (value.scope === 'object' || value.accessType === 'AnyObjectWrite')
      )
        issue('Listing is available only with bucket or prefix read access')
    }
  })

export type OciNativeInput = z.output<typeof ociNativeInputSchema>
export type OciNativeOperation = OciNativeInput['operation']
