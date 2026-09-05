import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import type { OracleEpmEndpoint, OracleEpmRequestInput } from '@/lib/internal/oracle-epm'
import {
  createOracleEpmClient,
  defineOracleEpmRouteSpace,
  OracleEpmError,
  oracleEpmLiteral,
  oracleEpmPathParameter,
  oracleEpmQuery,
} from '@/lib/internal/oracle-epm'
import {
  type OracleEpmDataAction,
  type OracleEpmDataInput,
  oracleEpmDataSchemas,
} from '@/lib/internal/oracle-epm-data/schema'
import type { OracleEpmDataAuthParams } from '@/tools/oracle_epm_data/types'
import type { ToolResponse } from '@/tools/types'

export const ORACLE_EPM_DATA_FILE_MAX_BYTES = 100 * 1024 * 1024
export const ORACLE_EPM_DATA_MAX_ITEMS = 10_000
const aif = defineOracleEpmRouteSpace({ context: ['aif', 'rest'], allowedVersions: ['V1'] })
const interop = defineOracleEpmRouteSpace({
  context: ['interop', 'rest'],
  allowedVersions: ['v2', '11.1.2.3.600'],
})
const json = {
  response: 'json',
  timeoutMs: 30_000,
  maxResponseBytes: MAX_INLINE_MATERIALIZATION_BYTES,
} as const
const jsonBody = { body: 'json', maxRequestBytes: MAX_INLINE_MATERIALIZATION_BYTES } as const
const connections = ['objects', 'connections'].map(oracleEpmLiteral)
const repository = [
  oracleEpmLiteral('applicationsnapshots'),
  oracleEpmPathParameter('fileName', { maxBytes: 255, mode: 'repository-path' }),
  oracleEpmLiteral('contents'),
]

/** Exact versions and route shapes come from Oracle's Data Integration and Interop REST reference. */
export const oracleEpmDataEndpoints = {
  listConnections: aif.defineEndpoint({
    ...json,
    method: 'GET',
    version: 'V1',
    path: connections,
    body: 'none',
  }),
  getConnection: aif.defineEndpoint({
    ...json,
    method: 'GET',
    version: 'V1',
    path: [...connections, oracleEpmPathParameter('connectionName', { maxBytes: 255 })],
    body: 'none',
  }),
  updateConnection: aif.defineEndpoint({
    ...json,
    ...jsonBody,
    method: 'PUT',
    version: 'V1',
    path: connections,
  }),
  getPipeline: aif.defineEndpoint({
    ...json,
    method: 'GET',
    version: 'V1',
    path: [oracleEpmLiteral('pipeline')],
    body: 'none',
    query: { pipelineName: oracleEpmQuery.string({ maxBytes: 255, required: true }) },
  }),
  submitJob: aif.defineEndpoint({
    ...json,
    ...jsonBody,
    timeoutMs: 300_000,
    method: 'POST',
    version: 'V1',
    path: [oracleEpmLiteral('jobs')],
  }),
  getJob: aif.defineEndpoint({
    ...json,
    method: 'GET',
    version: 'V1',
    path: [
      oracleEpmLiteral('jobs'),
      oracleEpmPathParameter('jobId', { maxBytes: 255, pattern: /^[1-9]\d*$/ }),
    ],
    body: 'none',
  }),
  snapshot: aif.defineEndpoint({
    ...json,
    ...jsonBody,
    method: 'POST',
    version: 'V1',
    path: [oracleEpmLiteral('snapshots')],
  }),
  getPov: aif.defineEndpoint({
    ...json,
    method: 'GET',
    version: 'V1',
    path: [oracleEpmLiteral('POV')],
    body: 'none',
    query: {
      application: oracleEpmQuery.string({ maxBytes: 255 }),
      location: oracleEpmQuery.string({ maxBytes: 255 }),
      period: oracleEpmQuery.string({ maxBytes: 1024, required: true }),
      category: oracleEpmQuery.string({ maxBytes: 255, required: true }),
    },
  }),
  setPov: aif.defineEndpoint({
    ...json,
    ...jsonBody,
    method: 'POST',
    version: 'V1',
    path: [oracleEpmLiteral('POV')],
  }),
  listFiles: interop.defineEndpoint({
    ...json,
    method: 'GET',
    version: 'v2',
    path: ['files', 'list'].map(oracleEpmLiteral),
    body: 'none',
  }),
  deleteFile: interop.defineEndpoint({
    ...json,
    ...jsonBody,
    method: 'DELETE',
    version: 'v2',
    path: ['files', 'delete'].map(oracleEpmLiteral),
  }),
  uploadFile: interop.defineEndpoint({
    ...json,
    method: 'POST',
    version: '11.1.2.3.600',
    path: repository,
    body: 'stream',
    maxRequestBytes: ORACLE_EPM_DATA_FILE_MAX_BYTES,
    timeoutMs: 300_000,
    query: { extDirPath: oracleEpmQuery.string({ maxBytes: 255 }) },
  }),
  downloadFile: interop.defineEndpoint({
    method: 'GET',
    version: '11.1.2.3.600',
    path: repository,
    body: 'none',
    response: 'stream',
    timeoutMs: 300_000,
    maxResponseBytes: ORACLE_EPM_DATA_FILE_MAX_BYTES,
  }),
} as const

/** Both numeric values and decimal strings appear in Oracle's published job responses. */
export const oracleEpmDataStatusSchema = z
  .union([
    z.number().int(),
    z
      .string()
      .regex(/^-?\d+$/)
      .transform(Number),
  ])
  .refine(Number.isSafeInteger)
const text = z.string().max(MAX_INLINE_MATERIALIZATION_BYTES)
const nullableText = text.nullable()
const id = z.union([
  z.number().int().nonnegative().safe().transform(String),
  z.string().regex(/^\d+$/),
])
export const oracleEpmDataStatusResponseSchema = z.object({
  status: oracleEpmDataStatusSchema,
  details: nullableText.optional().transform((value) => value ?? null),
})
export const oracleEpmDataMessageSchema = oracleEpmDataStatusResponseSchema.extend({
  response: text,
})
export const oracleEpmDataConnectionsSchema = oracleEpmDataStatusResponseSchema.extend({
  response: z
    .array(z.object({ connectionName: text, refUrl: text }))
    .max(ORACLE_EPM_DATA_MAX_ITEMS),
})
export const oracleEpmDataConnectionSchema = oracleEpmDataStatusResponseSchema.extend({
  response: z.object({
    status: oracleEpmDataStatusSchema,
    sourceSystemId: id,
    sourceSystemName: text,
    sourceSystemType: text,
    sourceSystemDescription: nullableText.optional(),
    sourceSystemOptions: z
      .array(z.object({ optionName: text, optionValue: text }))
      .max(ORACLE_EPM_DATA_MAX_ITEMS),
  }),
})
export const oracleEpmDataFilesSchema = oracleEpmDataStatusResponseSchema.extend({
  items: z
    .array(z.object({ name: text, type: text, size: nullableText, lastmodifiedtime: nullableText }))
    .max(ORACLE_EPM_DATA_MAX_ITEMS),
})
export const oracleEpmDataPovSchema = oracleEpmDataStatusResponseSchema.extend({
  response: z
    .array(
      z.object({ period: text, category: text, status: text, application: text, location: text })
    )
    .max(ORACLE_EPM_DATA_MAX_ITEMS),
})
export const oracleEpmDataJobSchema = oracleEpmDataStatusResponseSchema.extend({
  jobId: id,
  jobName: nullableText.optional(),
  jobStatus: nullableText.optional(),
  descriptiveStatus: nullableText.optional(),
  logFileName: nullableText.optional(),
  outputFileName: nullableText.optional(),
  processType: nullableText.optional(),
  executedBy: nullableText.optional(),
  action: z.enum(['IMPORT', 'EXPORT']).optional(),
  snapshotType: text.optional(),
})

const pipelineParameter = z.object({ paramName: text, paramValue: nullableText, paramLevel: text })
const pipelineJob = z.object({
  jobType: text,
  jobName: text,
  jobID: z.number().int(),
  jobSeq: z.number().int(),
  jobObject: nullableText.optional(),
  jobConnection: nullableText.optional(),
  status: nullableText.optional(),
  endTime: nullableText.optional(),
  logFile: nullableText.optional(),
  processId: z.number().int().nullable().optional(),
  parameters: z.array(pipelineParameter).max(ORACLE_EPM_DATA_MAX_ITEMS),
})
const pipelineStage = z.object({
  stageName: text,
  stageDisplayName: text,
  stageID: z.number().int(),
  stageSequence: z.number().int(),
  stageParallel: text,
  plNextStageSuccess: text,
  plNextStageFailure: text,
  jobs: z.array(pipelineJob).max(ORACLE_EPM_DATA_MAX_ITEMS),
})
/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_pipeline.html */
export const oracleEpmDataPipelineSchema = oracleEpmDataStatusResponseSchema.extend({
  response: z.object({
    name: text,
    displayName: text,
    id: z.number().int(),
    parallelJobs: z.number().int(),
    variables: z
      .array(
        z.object({
          varName: text,
          varDisplayName: text,
          varDefaultValue: nullableText,
          varType: text,
          varValObject: nullableText,
          varSequence: z.number().int(),
          varDefaultParam: text,
        })
      )
      .max(ORACLE_EPM_DATA_MAX_ITEMS),
    stages: z.array(pipelineStage).max(ORACLE_EPM_DATA_MAX_ITEMS),
    status: nullableText.optional(),
    processId: z.number().int().nullable().optional(),
    lastUpdatedDate: nullableText.optional(),
    proxyAdminUser: nullableText.optional(),
  }),
})

export function oracleEpmDataClient(auth: OracleEpmDataAuthParams) {
  return createOracleEpmClient({
    instanceUrl: auth.instanceUrl ?? '',
    accessToken: auth.accessToken ?? '',
  })
}

/** The transport is foundation-owned; this adapter only asserts the declared JSON response mode. */
export async function requestOracleEpmDataJson(
  auth: OracleEpmDataAuthParams,
  endpoint: OracleEpmEndpoint,
  input: OracleEpmRequestInput = {}
) {
  const response = await oracleEpmDataClient(auth).request(endpoint, input)
  if (!('data' in response)) throw new Error('Oracle EPM did not return the declared JSON response')
  return response
}

/** Applies the same input and failure contract to direct tools and selector callers. */
export async function executeOracleEpmDataOperation<A extends OracleEpmDataAction>(
  action: A,
  input: unknown,
  signal: AbortSignal | undefined,
  execute: (input: OracleEpmDataInput<A>) => Promise<ToolResponse>
): Promise<ToolResponse> {
  const parsed = oracleEpmDataSchemas[action].safeParse(input)
  if (!parsed.success)
    return {
      success: false,
      retryable: false,
      output: {},
      error: `Invalid Oracle EPM ${action} input: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    }
  try {
    signal?.throwIfAborted()
    return await execute(parsed.data as OracleEpmDataInput<A>)
  } catch (error) {
    return {
      success: false,
      retryable: false,
      output:
        error instanceof OracleEpmError && error.status !== undefined
          ? { httpStatus: error.status }
          : {},
      error:
        error instanceof z.ZodError
          ? 'Oracle EPM returned a malformed documented response'
          : getErrorMessage(error, 'Oracle EPM operation failed'),
    }
  }
}

/** Provider status is checked before parsing success-only fields. */
export function projectOracleEpmDataResult<T>(
  response: { status: number; data: unknown },
  schema: z.ZodType<T>,
  project: (data: T) => object
): ToolResponse {
  const status = oracleEpmDataStatusResponseSchema.parse(response.data)
  if (status.status !== 0)
    return {
      success: false,
      retryable: false,
      output: { httpStatus: response.status, ...status },
      error: `Oracle EPM returned status ${status.status}`,
    }
  return {
    success: true,
    output: { httpStatus: response.status, ...project(schema.parse(response.data)) },
  }
}
