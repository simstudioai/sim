import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateExternalUrl } from '@/lib/core/security/input-validation'
import { CADENCE_TYPES, DESTINATION_TYPES, SOURCE_TYPES } from '@/lib/data-drains/types'

/** AWS S3 bucket: 3-63 chars, lowercase alnum + . / -, see s3.ts for full rules. */
const S3_BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const S3_IPV4_LIKE_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const AWS_REGION_RE = /^[a-z]{2,}(-[a-z]+)+-\d+$/
/** GCS bucket component: lowercase alnum + _ / -, start/end alnum. Mirrors gcs.ts. */
const GCS_BUCKET_COMPONENT_RE = /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/
const GOOGLE_RESERVED_PREFIX_RE = /^(goog|google|g00gle)/i
const GOOGLE_CONTAINS_RE = /(google|g00gle)/i
function validateGcsBucketComponents(v: string): string | null {
  if (v.length < 3 || v.length > 222) return 'bucket must be 3-222 characters'
  const components = v.split('.')
  for (const c of components) {
    if (c.length < 1 || c.length > 63) {
      return 'each dot-separated component must be 1-63 characters'
    }
    if (!GCS_BUCKET_COMPONENT_RE.test(c)) {
      return 'each component must be lowercase, start/end alphanumeric, letters/digits/_/- only'
    }
  }
  return null
}
/** Azure storage account: 3-24 lowercase alnum. */
const AZURE_ACCOUNT_NAME_RE = /^[a-z0-9]{3,24}$/
/** Azure container: 3-63 chars, lowercase alnum + single hyphens. */
const AZURE_CONTAINER_NAME_RE = /^[a-z0-9]([a-z0-9]|-(?!-))+[a-z0-9]$/
/** Azure Blob Storage endpoint suffixes (Public, US Gov, China, Germany). */
const AZURE_ENDPOINT_SUFFIXES = [
  'blob.core.windows.net',
  'blob.core.usgovcloudapi.net',
  'blob.core.chinacloudapi.cn',
  'blob.core.cloudapi.de',
] as const
/** BigQuery project / dataset / table identifiers. */
const BQ_PROJECT_ID_RE = /^([a-z][a-z0-9.-]{0,61}[a-z0-9]:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/
const BQ_DATASET_RE = /^[A-Za-z0-9_]{1,1024}$/
const BQ_TABLE_RE = /^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd} ]{1,1024}$/u
/** Snowflake account + identifier shapes — mirrored from snowflake.ts. */
const SNOWFLAKE_ACCOUNT_ORG_RE = /^[A-Za-z0-9][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)+$/
/** First segment allows hyphens so org-account identifiers carrying a region/cloud suffix match. Mirrors snowflake.ts. */
const SNOWFLAKE_ACCOUNT_LOCATOR_RE =
  /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*){0,2}$/
const SNOWFLAKE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,254}$/
/** Reserved Sim-namespaced header names that cannot be reused as the webhook signature header. */
const RESERVED_WEBHOOK_SIGNATURE_HEADER_NAMES = new Set([
  'authorization',
  'content-type',
  'user-agent',
  'idempotency-key',
  'x-sim-timestamp',
  'x-sim-signature-version',
  'x-sim-drain-id',
  'x-sim-run-id',
  'x-sim-source',
  'x-sim-sequence',
  'x-sim-row-count',
  'x-sim-probe',
  'x-sim-signature',
])

export const dataDrainSourceSchema = z.enum(SOURCE_TYPES)
export const dataDrainDestinationTypeSchema = z.enum(DESTINATION_TYPES)
export const dataDrainCadenceSchema = z.enum(CADENCE_TYPES)
export const dataDrainRunStatusSchema = z.enum(['running', 'success', 'failed'])
export const dataDrainRunTriggerSchema = z.enum(['cron', 'manual'])

export const dataDrainOrgParamsSchema = z.object({
  id: z.string().min(1, 'organization id is required'),
})

export const dataDrainParamsSchema = z.object({
  id: z.string().min(1, 'organization id is required'),
  drainId: z.string().min(1, 'drain id is required'),
})

const drainNameSchema = z.string().trim().min(1, 'name is required').max(120)

const s3ConfigBodySchema = z.object({
  bucket: z
    .string()
    .min(3, 'bucket must be 3-63 characters')
    .max(63, 'bucket must be 3-63 characters')
    .refine((v) => S3_BUCKET_NAME_RE.test(v), {
      message: 'bucket must be lowercase, 3-63 chars, start/end alphanumeric',
    })
    .refine((v) => !v.includes('..'), { message: 'bucket must not contain consecutive dots' })
    .refine((v) => !v.includes('-.') && !v.includes('.-'), {
      message: 'bucket must not contain a dash adjacent to a dot',
    })
    .refine((v) => !S3_IPV4_LIKE_RE.test(v), { message: 'bucket must not look like an IP address' })
    .refine((v) => !v.startsWith('xn--'), { message: 'bucket must not start with "xn--"' })
    .refine((v) => !v.startsWith('sthree-'), { message: 'bucket must not start with "sthree-"' })
    .refine((v) => !v.startsWith('amzn-s3-demo-'), {
      message: 'bucket must not start with "amzn-s3-demo-" (reserved by AWS)',
    })
    .refine(
      (v) =>
        !v.endsWith('-s3alias') &&
        !v.endsWith('--ol-s3') &&
        !v.endsWith('.mrap') &&
        !v.endsWith('--x-s3') &&
        !v.endsWith('--table-s3'),
      {
        message:
          'bucket must not end with reserved suffix (-s3alias, --ol-s3, .mrap, --x-s3, --table-s3)',
      }
    ),
  region: z
    .string()
    .min(1, 'region is required')
    .max(32, 'region is too long')
    .refine((v) => AWS_REGION_RE.test(v), {
      message: 'region must look like an AWS region code, e.g. us-east-1',
    }),
  prefix: z
    .string()
    .max(512)
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 512, {
      message: 'prefix must be at most 512 bytes (UTF-8)',
    })
    .optional(),
  endpoint: z
    .string()
    .url()
    .refine((v) => v.startsWith('https://'), { message: 'endpoint must use https://' })
    .refine((value) => validateExternalUrl(value, 'endpoint').isValid, {
      message: 'endpoint must be HTTPS and not point at a private, loopback, or metadata address',
    })
    .optional(),
  forcePathStyle: z.boolean().optional(),
})

const s3CredentialsBodySchema = z.object({
  accessKeyId: z.string().min(1, 'accessKeyId is required'),
  secretAccessKey: z.string().min(1, 'secretAccessKey is required'),
})

const gcsConfigBodySchema = z.object({
  bucket: z
    .string()
    .min(3, 'bucket must be 3-222 characters')
    .max(222, 'bucket must be 3-222 characters')
    .superRefine((v, ctx) => {
      const err = validateGcsBucketComponents(v)
      if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err })
    })
    .refine((v) => !S3_IPV4_LIKE_RE.test(v), { message: 'bucket must not look like an IP address' })
    .refine((v) => !v.includes('..'), { message: 'bucket must not contain consecutive dots' })
    .refine((v) => !v.includes('-.') && !v.includes('.-'), {
      message: 'bucket must not contain "-." or ".-"',
    })
    .refine((v) => !GOOGLE_RESERVED_PREFIX_RE.test(v) && !GOOGLE_CONTAINS_RE.test(v), {
      message: 'bucket name cannot begin with "goog" or contain "google" / close misspellings',
    }),
  prefix: z
    .string()
    .max(512)
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 512, {
      message: 'prefix must be at most 512 bytes (UTF-8)',
    })
    .refine((v) => !v.startsWith('.well-known/acme-challenge/'), {
      message: 'prefix must not start with ".well-known/acme-challenge/" (reserved by GCS)',
    })
    .optional(),
})

const gcsCredentialsBodySchema = z.object({
  serviceAccountJson: z.string().min(1, 'serviceAccountJson is required'),
})

const azureBlobConfigBodySchema = z.object({
  accountName: z
    .string()
    .min(1, 'accountName is required')
    .refine((v) => AZURE_ACCOUNT_NAME_RE.test(v), {
      message: 'accountName must be 3-24 lowercase letters or digits',
    }),
  containerName: z
    .string()
    .min(3, 'containerName must be 3-63 characters')
    .max(63)
    .refine((v) => AZURE_CONTAINER_NAME_RE.test(v), {
      message: 'containerName must use lowercase letters, digits, or single hyphens',
    }),
  prefix: z.string().max(512).optional(),
  endpointSuffix: z
    .string()
    .refine((v) => (AZURE_ENDPOINT_SUFFIXES as readonly string[]).includes(v), {
      message: `endpointSuffix must be one of: ${AZURE_ENDPOINT_SUFFIXES.join(', ')}`,
    })
    .optional(),
})

const azureBlobCredentialsBodySchema = z.object({
  accountKey: z
    .string()
    .length(88, 'accountKey must be 88 base64 characters (64-byte Azure storage key)')
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, {
      message: 'accountKey must be a base64-encoded Azure storage account key',
    }),
})

const DATADOG_TAG_PAIR_RE = /^[A-Za-z][A-Za-z0-9_./-]*:[^,\s][^,]*$/

const datadogConfigBodySchema = z.object({
  site: z.enum(['us1', 'us3', 'us5', 'eu1', 'ap1', 'ap2', 'gov']),
  service: z.string().min(1).max(100).optional(),
  tags: z
    .string()
    .min(1)
    .max(1024)
    .refine(
      (v) =>
        v
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .every((t) => DATADOG_TAG_PAIR_RE.test(t)),
      { message: 'tags must be comma-separated key:value pairs' }
    )
    .optional(),
})

const datadogCredentialsBodySchema = z.object({
  apiKey: z.string().min(1, 'apiKey is required'),
})

const bigqueryConfigBodySchema = z.object({
  projectId: z
    .string()
    .min(6, 'projectId is required')
    .max(94)
    .refine((v) => BQ_PROJECT_ID_RE.test(v), {
      message: 'projectId must match Google Cloud project ID rules',
    }),
  datasetId: z
    .string()
    .min(1, 'datasetId is required')
    .refine((v) => BQ_DATASET_RE.test(v), {
      message: 'datasetId may only contain letters, digits, and underscores (max 1024)',
    }),
  tableId: z
    .string()
    .min(1, 'tableId is required')
    .refine((v) => BQ_TABLE_RE.test(v), {
      message:
        'tableId may contain Unicode letters, marks, numbers, connectors, dashes, and spaces (max 1024)',
    })
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 1024, {
      message: 'tableId must be at most 1024 bytes (UTF-8)',
    }),
})

const bigqueryCredentialsBodySchema = z.object({
  serviceAccountJson: z.string().min(1, 'serviceAccountJson is required'),
})

const snowflakeConfigBodySchema = z.object({
  account: z
    .string()
    .min(3, 'account is required')
    .max(256)
    .refine((v) => SNOWFLAKE_ACCOUNT_ORG_RE.test(v) || SNOWFLAKE_ACCOUNT_LOCATOR_RE.test(v), {
      message:
        'account must be a Snowflake org-account identifier (orgname-accountname) or legacy locator (locator[.region[.cloud]])',
    }),
  user: z.string().min(1, 'user is required').regex(SNOWFLAKE_IDENTIFIER_RE, {
    message: 'user must be a valid Snowflake identifier',
  }),
  warehouse: z.string().min(1).regex(SNOWFLAKE_IDENTIFIER_RE, {
    message: 'warehouse must be a valid Snowflake identifier',
  }),
  database: z.string().min(1).regex(SNOWFLAKE_IDENTIFIER_RE, {
    message: 'database must be a valid Snowflake identifier',
  }),
  schema: z.string().min(1).regex(SNOWFLAKE_IDENTIFIER_RE, {
    message: 'schema must be a valid Snowflake identifier',
  }),
  table: z.string().min(1).regex(SNOWFLAKE_IDENTIFIER_RE, {
    message: 'table must be a valid Snowflake identifier',
  }),
  column: z
    .string()
    .min(1)
    .regex(SNOWFLAKE_IDENTIFIER_RE, { message: 'column must be a valid Snowflake identifier' })
    .optional(),
  role: z
    .string()
    .min(1)
    .regex(SNOWFLAKE_IDENTIFIER_RE, { message: 'role must be a valid Snowflake identifier' })
    .optional(),
})

const snowflakeCredentialsBodySchema = z.object({
  privateKey: z.string().min(1, 'privateKey is required'),
})

const webhookConfigBodySchema = z.object({
  url: z
    .string()
    .url('url must be a valid URL')
    .max(2048, 'url must be at most 2048 characters')
    .refine((value) => validateExternalUrl(value, 'url').isValid, {
      message: 'url must be HTTPS and not point at a private, loopback, or metadata address',
    }),
  signatureHeader: z
    .string()
    .min(1)
    .max(128)
    .refine((value) => !RESERVED_WEBHOOK_SIGNATURE_HEADER_NAMES.has(value.toLowerCase()), {
      message: 'signatureHeader cannot reuse a reserved Sim header name',
    })
    .refine((value) => /^[A-Za-z0-9\-_]+$/.test(value) && !/[\r\n\0]/.test(value), {
      message: 'signatureHeader must contain only letters, digits, hyphens, and underscores',
    })
    .optional(),
})

const webhookCredentialsBodySchema = z.object({
  signingSecret: z
    .string()
    .min(32, 'signingSecret must be at least 32 characters')
    .max(512, 'signingSecret must be at most 512 characters'),
  bearerToken: z
    .string()
    .min(1)
    .max(4096, 'bearerToken must be at most 4096 characters')
    .refine((value) => !/[\r\n\0]/.test(value), {
      message: 'bearerToken cannot contain CR, LF, or NUL characters',
    })
    .optional(),
})

/**
 * Discriminated body shape used by both create and update. Each destination
 * variant carries its own typed `destinationConfig` and optional
 * `destinationCredentials`. On update, omitting `destinationCredentials`
 * leaves the encrypted blob in place.
 */
export const dataDrainDestinationBodySchema = z.discriminatedUnion('destinationType', [
  z.object({
    destinationType: z.literal('s3'),
    destinationConfig: s3ConfigBodySchema,
    destinationCredentials: s3CredentialsBodySchema.optional(),
  }),
  z.object({
    destinationType: z.literal('gcs'),
    destinationConfig: gcsConfigBodySchema,
    destinationCredentials: gcsCredentialsBodySchema.optional(),
  }),
  z.object({
    destinationType: z.literal('azure_blob'),
    destinationConfig: azureBlobConfigBodySchema,
    destinationCredentials: azureBlobCredentialsBodySchema.optional(),
  }),
  z.object({
    destinationType: z.literal('datadog'),
    destinationConfig: datadogConfigBodySchema,
    destinationCredentials: datadogCredentialsBodySchema.optional(),
  }),
  z.object({
    destinationType: z.literal('bigquery'),
    destinationConfig: bigqueryConfigBodySchema,
    destinationCredentials: bigqueryCredentialsBodySchema.optional(),
  }),
  z.object({
    destinationType: z.literal('snowflake'),
    destinationConfig: snowflakeConfigBodySchema,
    destinationCredentials: snowflakeCredentialsBodySchema.optional(),
  }),
  z.object({
    destinationType: z.literal('webhook'),
    destinationConfig: webhookConfigBodySchema,
    destinationCredentials: webhookCredentialsBodySchema.optional(),
  }),
])

const drainCommonBodyFieldsSchema = z.object({
  name: drainNameSchema,
  source: dataDrainSourceSchema,
  scheduleCadence: dataDrainCadenceSchema,
  enabled: z.boolean().optional(),
})

export const createDataDrainBodySchema = z.intersection(
  drainCommonBodyFieldsSchema,
  dataDrainDestinationBodySchema
)

/**
 * Update bodies are partial — every field is optional. We deliberately don't
 * use a discriminated union here: clients sending `{ enabled: false }` should
 * not be forced to also send `destinationType`. The route validates the
 * destination payloads against the typed `configSchema` / `credentialsSchema`
 * for the existing drain's destination type before persisting, so the
 * structural shape is still enforced — just at the route layer rather than at
 * the contract boundary.
 */
export const updateDataDrainBodySchema = drainCommonBodyFieldsSchema.partial().extend({
  destinationType: dataDrainDestinationTypeSchema.optional(),
  destinationConfig: z.record(z.string(), z.unknown()).optional(),
  destinationCredentials: z.record(z.string(), z.unknown()).optional(),
})

const drainDestinationResponseSchema = z.discriminatedUnion('destinationType', [
  z.object({
    destinationType: z.literal('s3'),
    destinationConfig: s3ConfigBodySchema,
  }),
  z.object({
    destinationType: z.literal('gcs'),
    destinationConfig: gcsConfigBodySchema,
  }),
  z.object({
    destinationType: z.literal('azure_blob'),
    destinationConfig: azureBlobConfigBodySchema,
  }),
  z.object({
    destinationType: z.literal('datadog'),
    destinationConfig: datadogConfigBodySchema,
  }),
  z.object({
    destinationType: z.literal('bigquery'),
    destinationConfig: bigqueryConfigBodySchema,
  }),
  z.object({
    destinationType: z.literal('snowflake'),
    destinationConfig: snowflakeConfigBodySchema,
  }),
  z.object({
    destinationType: z.literal('webhook'),
    destinationConfig: webhookConfigBodySchema,
  }),
])

const drainCommonResponseFieldsSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  source: dataDrainSourceSchema,
  scheduleCadence: dataDrainCadenceSchema,
  enabled: z.boolean(),
  cursor: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const dataDrainSchema = z.intersection(
  drainCommonResponseFieldsSchema,
  drainDestinationResponseSchema
)

export type DataDrain = z.output<typeof dataDrainSchema>
export type CreateDataDrainBody = z.input<typeof createDataDrainBodySchema>
export type UpdateDataDrainBody = z.input<typeof updateDataDrainBodySchema>

export const dataDrainListResponseSchema = z.object({
  drains: z.array(dataDrainSchema),
})

export const dataDrainResponseSchema = z.object({
  drain: dataDrainSchema,
})

export const dataDrainRunSchema = z.object({
  id: z.string(),
  drainId: z.string(),
  status: dataDrainRunStatusSchema,
  trigger: dataDrainRunTriggerSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  rowsExported: z.number().int(),
  bytesWritten: z.number().int(),
  cursorBefore: z.string().nullable(),
  cursorAfter: z.string().nullable(),
  error: z.string().nullable(),
  locators: z.array(z.string()),
})

export type DataDrainRun = z.output<typeof dataDrainRunSchema>

export const dataDrainRunListResponseSchema = z.object({
  runs: z.array(dataDrainRunSchema),
})

export const runDataDrainResponseSchema = z.object({
  jobId: z.string(),
})

export const testDataDrainResponseSchema = z.object({
  ok: z.literal(true),
})

export const listDataDrainsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/data-drains',
  params: dataDrainOrgParamsSchema,
  response: { mode: 'json', schema: dataDrainListResponseSchema },
})

export const createDataDrainContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/data-drains',
  params: dataDrainOrgParamsSchema,
  body: createDataDrainBodySchema,
  response: { mode: 'json', schema: dataDrainResponseSchema },
})

export const getDataDrainContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/data-drains/[drainId]',
  params: dataDrainParamsSchema,
  response: { mode: 'json', schema: dataDrainResponseSchema },
})

export const updateDataDrainContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/data-drains/[drainId]',
  params: dataDrainParamsSchema,
  body: updateDataDrainBodySchema,
  response: { mode: 'json', schema: dataDrainResponseSchema },
})

export const deleteDataDrainContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/data-drains/[drainId]',
  params: dataDrainParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

export const runDataDrainContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/data-drains/[drainId]/run',
  params: dataDrainParamsSchema,
  response: { mode: 'json', schema: runDataDrainResponseSchema },
})

export const testDataDrainContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/data-drains/[drainId]/test',
  params: dataDrainParamsSchema,
  response: { mode: 'json', schema: testDataDrainResponseSchema },
})

export const listDataDrainRunsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/data-drains/[drainId]/runs',
  params: dataDrainParamsSchema,
  query: z
    .object({
      limit: z
        .preprocess(
          (v) => (typeof v === 'string' ? Number.parseInt(v, 10) : v),
          z.number().int().min(1).max(200)
        )
        .optional(),
    })
    .optional(),
  response: { mode: 'json', schema: dataDrainRunListResponseSchema },
})
