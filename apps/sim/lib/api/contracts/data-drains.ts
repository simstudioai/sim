import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { CADENCE_TYPES, DESTINATION_TYPES, SOURCE_TYPES } from '@/lib/data-drains/types'

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
  bucket: z.string().min(1, 'bucket is required').max(255),
  region: z.string().min(1, 'region is required').max(64),
  prefix: z.string().max(512).optional(),
  endpoint: z.string().url().optional(),
  forcePathStyle: z.boolean().optional(),
})

const s3CredentialsBodySchema = z.object({
  accessKeyId: z.string().min(1, 'accessKeyId is required'),
  secretAccessKey: z.string().min(1, 'secretAccessKey is required'),
})

const webhookConfigBodySchema = z.object({
  url: z.string().url('url must be a valid URL'),
  signatureHeader: z.string().min(1).max(128).optional(),
})

const webhookCredentialsBodySchema = z.object({
  signingSecret: z.string().min(8, 'signingSecret must be at least 8 characters'),
  bearerToken: z.string().min(1).optional(),
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
