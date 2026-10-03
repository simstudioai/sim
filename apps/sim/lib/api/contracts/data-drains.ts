import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  azureBlobConfigBodySchema,
  bigqueryConfigBodySchema,
  createDataDrainBodySchema,
  dataDrainCadenceSchema,
  dataDrainOrgParamsSchema,
  dataDrainParamsSchema,
  dataDrainRunStatusSchema,
  dataDrainRunTriggerSchema,
  dataDrainSourceSchema,
  datadogConfigBodySchema,
  gcsConfigBodySchema,
  s3ConfigBodySchema,
  snowflakeConfigBodySchema,
  updateDataDrainBodySchema,
  webhookConfigBodySchema,
} from '@/lib/data-drains/validation'

export {
  createDataDrainBodySchema,
  dataDrainCadenceSchema,
  dataDrainDestinationBodySchema,
  dataDrainDestinationTypeSchema,
  dataDrainOrgParamsSchema,
  dataDrainParamsSchema,
  dataDrainRunStatusSchema,
  dataDrainRunTriggerSchema,
  dataDrainSourceSchema,
  updateDataDrainBodySchema,
} from '@/lib/data-drains/validation'

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
  response: { mode: 'json', schema: dataDrainResponseSchema, status: 201 },
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
