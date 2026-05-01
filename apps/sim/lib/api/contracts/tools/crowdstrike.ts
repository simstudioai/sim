import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import type { CrowdStrikeAggregateQuery } from '@/tools/crowdstrike/types'

const crowdstrikeNullableStringSchema = z.string().nullable()
const crowdstrikeNullableNumberSchema = z.number().nullable()

const crowdstrikePaginationSchema = z
  .object({
    limit: crowdstrikeNullableNumberSchema,
    offset: crowdstrikeNullableNumberSchema,
    total: crowdstrikeNullableNumberSchema,
  })
  .nullable()

const crowdstrikeSensorSchema = z.object({
  agentVersion: crowdstrikeNullableStringSchema,
  cid: crowdstrikeNullableStringSchema,
  deviceId: crowdstrikeNullableStringSchema,
  heartbeatTime: crowdstrikeNullableNumberSchema,
  hostname: crowdstrikeNullableStringSchema,
  idpPolicyId: crowdstrikeNullableStringSchema,
  idpPolicyName: crowdstrikeNullableStringSchema,
  ipAddress: crowdstrikeNullableStringSchema,
  kerberosConfig: crowdstrikeNullableStringSchema,
  ldapConfig: crowdstrikeNullableStringSchema,
  ldapsConfig: crowdstrikeNullableStringSchema,
  machineDomain: crowdstrikeNullableStringSchema,
  ntlmConfig: crowdstrikeNullableStringSchema,
  osVersion: crowdstrikeNullableStringSchema,
  rdpToDcConfig: crowdstrikeNullableStringSchema,
  smbToDcConfig: crowdstrikeNullableStringSchema,
  status: crowdstrikeNullableStringSchema,
  statusCauses: z.array(z.string()),
  tiEnabled: crowdstrikeNullableStringSchema,
})

const crowdstrikeAggregateBucketSchema = z.object({
  count: crowdstrikeNullableNumberSchema,
  from: crowdstrikeNullableNumberSchema,
  keyAsString: crowdstrikeNullableStringSchema,
  label: z.unknown().nullable(),
  stringFrom: crowdstrikeNullableStringSchema,
  stringTo: crowdstrikeNullableStringSchema,
  subAggregates: z.array(z.unknown()),
  to: crowdstrikeNullableNumberSchema,
  value: crowdstrikeNullableNumberSchema,
  valueAsString: crowdstrikeNullableStringSchema,
})

const crowdstrikeAggregateResultSchema = z.object({
  buckets: z.array(crowdstrikeAggregateBucketSchema),
  docCountErrorUpperBound: crowdstrikeNullableNumberSchema,
  name: crowdstrikeNullableStringSchema,
  sumOtherDocCount: crowdstrikeNullableNumberSchema,
})

const crowdstrikeSensorsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    count: z.number(),
    pagination: crowdstrikePaginationSchema,
    sensors: z.array(crowdstrikeSensorSchema),
  }),
})

const crowdstrikeAggregatesResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    aggregates: z.array(crowdstrikeAggregateResultSchema),
    count: z.number(),
  }),
})

const CROWDSTRIKE_CLOUDS = ['us-1', 'us-2', 'eu-1', 'us-gov-1', 'us-gov-2'] as const

const baseRequestSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  cloud: z.enum(CROWDSTRIKE_CLOUDS),
})

const dateRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
})

const extendedBoundsSchema = z.object({
  max: z.string(),
  min: z.string(),
})

const rangeSpecSchema = z.object({
  from: z.number(),
  to: z.number(),
})

const aggregateQuerySchema: z.ZodType<CrowdStrikeAggregateQuery> = z.lazy(() =>
  z.object({
    date_ranges: z.array(dateRangeSchema).optional(),
    exclude: z.string().optional(),
    extended_bounds: extendedBoundsSchema.optional(),
    field: z.string().optional(),
    filter: z.string().optional(),
    from: z.number().int().nonnegative().optional(),
    include: z.string().optional(),
    interval: z.string().optional(),
    max_doc_count: z.number().int().nonnegative().optional(),
    min_doc_count: z.number().int().nonnegative().optional(),
    missing: z.string().optional(),
    name: z.string().optional(),
    q: z.string().optional(),
    ranges: z.array(rangeSpecSchema).optional(),
    size: z.number().int().nonnegative().optional(),
    sort: z.string().optional(),
    sub_aggregates: z.array(aggregateQuerySchema).optional(),
    time_zone: z.string().optional(),
    type: z.string().optional(),
  })
)

const querySensorsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_query_sensors'),
  filter: z.string().optional(),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(200, 'Limit must be at most 200')
    .optional(),
  offset: z.number().int().nonnegative('Offset must be 0 or greater').optional(),
  sort: z.string().optional(),
})

const getSensorDetailsSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_get_sensor_details'),
  ids: z
    .array(z.string().trim().min(1, 'Sensor IDs must not be empty'))
    .min(1, 'At least one sensor ID is required')
    .max(5000, 'CrowdStrike supports up to 5000 sensor IDs per request'),
})

const getSensorAggregatesSchema = baseRequestSchema.extend({
  operation: z.literal('crowdstrike_get_sensor_aggregates'),
  aggregateQuery: aggregateQuerySchema,
})

export const crowdstrikeQueryBodySchema = z.discriminatedUnion('operation', [
  querySensorsSchema,
  getSensorDetailsSchema,
  getSensorAggregatesSchema,
])

export const crowdstrikeQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/crowdstrike/query',
  body: crowdstrikeQueryBodySchema,
  response: {
    mode: 'json',
    schema: z.union([crowdstrikeSensorsResponseSchema, crowdstrikeAggregatesResponseSchema]),
  },
})

export type CrowdstrikeQueryBody = ContractBody<typeof crowdstrikeQueryContract>
export type CrowdstrikeQueryBodyInput = ContractBodyInput<typeof crowdstrikeQueryContract>
export type CrowdstrikeQueryResponse = ContractJsonResponse<typeof crowdstrikeQueryContract>
