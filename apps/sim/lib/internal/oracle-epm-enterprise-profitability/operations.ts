import { isPlainRecord } from '@sim/utils/object'
import { z } from 'zod'
import {
  createOracleEpmClient,
  defineOracleEpmRouteSpace,
  oracleEpmLiteral as literal,
  type OracleEpmClient,
  type OracleEpmEndpoint,
  oracleEpmQuery,
  oracleEpmPathParameter as parameter,
} from '@/lib/internal/oracle-epm'
import {
  EPCM_EXCHANGE_JOB_TYPES,
  EPCM_MAX_JSON_BYTES,
  epcmDataGridSchema,
  epcmGridDefinitionSchema,
  epcmName,
  normalizeOracleEpcmApplications,
  normalizeOracleEpcmExportGrid,
  normalizeOracleEpcmImportResult,
  normalizeOracleEpcmJob,
  normalizeOracleEpcmJobDefinitions,
  normalizeOracleEpcmMember,
  OracleEpcmOperationError,
} from '@/lib/internal/oracle-epm-enterprise-profitability/normalizers'
import type {
  OracleEpcmAuthParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  parseOracleEpcmBoolean,
  parseOracleEpcmJson,
} from '@/tools/oracle_epm_enterprise_profitability/utils'

export const epcmPlanningRoutes = defineOracleEpmRouteSpace({
  context: ['HyperionPlanning', 'rest'],
  allowedVersions: ['v3'],
})

export const epcmApplicationPath = [
  literal('applications'),
  parameter('applicationName', { maxBytes: 255 }),
]
export const epcmJsonPolicy = {
  version: 'v3',
  response: 'json',
  timeoutMs: 30_000,
  maxResponseBytes: EPCM_MAX_JSON_BYTES,
} as const

const applicationsEndpoint = epcmPlanningRoutes.defineEndpoint({
  ...epcmJsonPolicy,
  method: 'GET',
  path: [literal('applications')],
  body: 'none',
})
const membersPath = [
  ...epcmApplicationPath,
  literal('dimensions'),
  parameter('dimensionName', { maxBytes: 255 }),
  literal('members'),
]
const getMemberEndpoint = epcmPlanningRoutes.defineEndpoint({
  ...epcmJsonPolicy,
  method: 'GET',
  body: 'none',
  path: [...membersPath, parameter('memberName', { maxBytes: 255 })],
})
const addMemberEndpoint = epcmPlanningRoutes.defineEndpoint({
  ...epcmJsonPolicy,
  method: 'POST',
  path: membersPath,
  body: 'json',
  maxRequestBytes: EPCM_MAX_JSON_BYTES,
})
const definitionsEndpoint = epcmPlanningRoutes.defineEndpoint({
  ...epcmJsonPolicy,
  method: 'GET',
  path: [...epcmApplicationPath, literal('jobdefinitions')],
  query: { q: oracleEpmQuery.string({ maxBytes: 100 }) },
  body: 'none',
})
const submitEndpoint = epcmPlanningRoutes.defineEndpoint({
  ...epcmJsonPolicy,
  method: 'POST',
  path: [...epcmApplicationPath, literal('jobs')],
  body: 'json',
  maxRequestBytes: EPCM_MAX_JSON_BYTES,
})
const cubePath = [
  ...epcmApplicationPath,
  literal('plantypes'),
  parameter('cubeName', { maxBytes: 255 }),
]
const exportSliceEndpoint = epcmPlanningRoutes.defineEndpoint({
  ...epcmJsonPolicy,
  method: 'POST',
  path: [...cubePath, literal('exportdataslice')],
  body: 'json',
  maxRequestBytes: EPCM_MAX_JSON_BYTES,
})
const importSliceEndpoint = epcmPlanningRoutes.defineEndpoint({
  ...epcmJsonPolicy,
  method: 'POST',
  path: [...cubePath, literal('importdataslice')],
  body: 'json',
  maxRequestBytes: EPCM_MAX_JSON_BYTES,
})

export const epcmAuthSchema = z.object({
  oauthCredential: epcmName,
  accessToken: z.string().min(1).max(16_384),
  instanceUrl: z.string().min(1).max(4_096),
})
export const epcmApplicationSchema = epcmAuthSchema.extend({ applicationName: epcmName })
export const epcmOptionalString = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().min(1).max(4_096).optional()
)
export const epcmBoolean = z.preprocess(parseOracleEpcmBoolean, z.boolean().optional())
export const epcmNumber = (minimum: number, maximum: number, fallback?: number) =>
  z.preprocess(
    (value) =>
      value === '' || value === null || value === undefined
        ? fallback
        : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)
          ? Number(value)
          : value,
    z.number().int().min(minimum).max(maximum).optional()
  )

export function parseOracleEpcmInput<T>(schema: z.ZodType<T>, input: unknown): T {
  /** Empty editor fields mean omitted values; this runs only after variable resolution. */
  const values = isPlainRecord(input)
    ? Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ''))
    : input
  const parsed = schema.safeParse(values)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new OracleEpcmOperationError(
      `Invalid EPCM input ${issue?.path.join('.') || 'parameters'}: ${issue?.message || 'validation failed'}`
    )
  }
  return parsed.data
}

export function oracleEpcmClient(input: OracleEpcmAuthParams): OracleEpmClient {
  return createOracleEpmClient(parseOracleEpcmInput(epcmAuthSchema, input))
}

function parseGridInput<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  let parsed: unknown
  try {
    parsed = parseOracleEpcmJson(value, label)
  } catch {
    throw new OracleEpcmOperationError(
      `${label} must be valid JSON within the 4 MB input and supported complexity limits`
    )
  }
  return parseOracleEpcmInput(schema, parsed)
}

/** Projects JSON after the foundation has bounded and validated the HTTP response. */
export async function requestOracleEpcmJson(
  client: OracleEpmClient,
  endpoint: OracleEpmEndpoint,
  input: Parameters<OracleEpmClient['request']>[1]
): Promise<unknown> {
  const response = await client.request(endpoint, input)
  if (!('data' in response)) {
    throw new OracleEpcmOperationError('Oracle EPCM returned an unexpected response type', 502)
  }
  return response.data
}

export async function listOracleEpcmApplications(input: unknown, signal?: AbortSignal) {
  const auth = parseOracleEpcmInput(epcmAuthSchema, input)
  return normalizeOracleEpcmApplications(
    await requestOracleEpcmJson(oracleEpcmClient(auth), applicationsEndpoint, { signal })
  )
}

export async function listOracleEpcmJobDefinitions(input: unknown, signal?: AbortSignal) {
  const params = parseOracleEpcmInput(
    epcmApplicationSchema.extend({
      jobType: z.enum(EPCM_EXCHANGE_JOB_TYPES),
    }),
    input
  )
  return normalizeOracleEpcmJobDefinitions(
    await requestOracleEpcmJson(oracleEpcmClient(params), definitionsEndpoint, {
      pathParams: { applicationName: params.applicationName },
      query: { q: JSON.stringify({ jobType: params.jobType }) },
      signal,
    }),
    params.jobType
  )
}

const jobSchema = epcmApplicationSchema.extend({ jobName: epcmName })
const povShape = {
  povDelimiter: z.enum(['_', '#', '~', '%', ';', ':', '-']).default(':'),
  povName: epcmName,
}
const modelShape = { modelName: epcmName }
const calculationSchema = jobSchema
  .extend({
    ...modelShape,
    ...povShape,
    povName: z.string().min(1).max(4_096),
    executionType: z
      .enum(['ALL_RULES', 'RULESET_SUBSET', 'SINGLE_RULE', 'RUN_FROM_RULE', 'STOP_AFTER_RULE'])
      .default('ALL_RULES'),
    ruleName: epcmOptionalString,
    rulesetSeqNumStart: epcmNumber(0, 2_147_483_647),
    rulesetSeqNumEnd: epcmNumber(0, 2_147_483_647),
    clearCalculatedData: epcmBoolean,
    executeCalculations: epcmBoolean,
    optimizeForReporting: epcmBoolean,
    captureDebugScripts: epcmBoolean,
    comment: epcmOptionalString,
  })
  .superRefine((params, context) => {
    if (
      ['SINGLE_RULE', 'RUN_FROM_RULE', 'STOP_AFTER_RULE'].includes(params.executionType) &&
      !params.ruleName
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ruleName'],
        message: 'Rule name is required for this execution type',
      })
    }
    if (
      params.executionType === 'RULESET_SUBSET' &&
      (params.rulesetSeqNumStart === undefined ||
        params.rulesetSeqNumEnd === undefined ||
        params.rulesetSeqNumStart > params.rulesetSeqNumEnd)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rulesetSeqNumStart'],
        message: 'An ordered start/end rule-set sequence range is required',
      })
    }
  })

const exchangeSchema = epcmApplicationSchema.extend({
  jobName: epcmOptionalString,
  fileName: epcmOptionalString,
})
const optionalParameters = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))

async function submit(
  params: z.infer<typeof epcmApplicationSchema>,
  jobType: string,
  jobName: string | undefined,
  parameters: Record<string, unknown>,
  signal?: AbortSignal
): Promise<OracleEpcmResponse> {
  const output = normalizeOracleEpcmJob(
    await requestOracleEpcmJson(oracleEpcmClient(params), submitEndpoint, {
      pathParams: { applicationName: params.applicationName },
      json: optionalParameters({ jobType, jobName, parameters: optionalParameters(parameters) }),
      signal,
    })
  )
  return {
    success: output.state !== 'failed',
    output,
    retryable: false,
    ...(output.state === 'failed'
      ? { error: 'Oracle EPCM job failed; inspect the returned job ID and status' }
      : {}),
  }
}

export async function executeOracleEpcmOperation(
  operation: string,
  input: unknown,
  signal?: AbortSignal
): Promise<OracleEpcmResponse> {
  signal?.throwIfAborted()
  switch (operation) {
    case 'list_applications':
      return {
        success: true,
        output: { applications: await listOracleEpcmApplications(input, signal) },
      }
    case 'list_job_definitions':
      return {
        success: true,
        output: { jobDefinitions: await listOracleEpcmJobDefinitions(input, signal) },
      }
    case 'get_member':
    case 'add_member': {
      const params = parseOracleEpcmInput(
        epcmApplicationSchema.extend({
          dimensionName: epcmName,
          memberName: epcmName,
          parentName: epcmName.optional(),
        }),
        input
      )
      if (operation === 'add_member' && !params.parentName) {
        throw new OracleEpcmOperationError('parentName is required when adding a dynamic member')
      }
      const data = await requestOracleEpcmJson(
        oracleEpcmClient(params),
        operation === 'get_member' ? getMemberEndpoint : addMemberEndpoint,
        {
          pathParams: {
            applicationName: params.applicationName,
            dimensionName: params.dimensionName,
            ...(operation === 'get_member' ? { memberName: params.memberName } : {}),
          },
          ...(operation === 'add_member'
            ? { json: { memberName: params.memberName, parentName: params.parentName } }
            : {}),
          signal,
        }
      )
      return {
        success: true,
        output: { member: normalizeOracleEpcmMember(data) },
        retryable: false,
      }
    }
    case 'generate_model_documentation': {
      const params = parseOracleEpcmInput(
        jobSchema.extend({
          ...modelShape,
          fileName: epcmName,
          outputType: z.enum(['PDF', 'Word', 'Excel', 'HTML', 'XML']).default('PDF'),
        }),
        input
      )
      return submit(
        params,
        'Generate EPCM Report',
        params.jobName,
        {
          reportName: 'MODEL_DOC',
          outputFileName: params.fileName,
          outputType: params.outputType,
          modelName: params.modelName,
        },
        signal
      )
    }
    case 'validate_model': {
      const params = parseOracleEpcmInput(
        jobSchema.extend({
          ...modelShape,
          fileName: epcmName,
          ruleStatus: z.enum(['All', 'Enabled', 'Disabled']).default('All'),
        }),
        input
      )
      return submit(
        params,
        'Validate Model',
        params.jobName,
        {
          modelName: params.modelName,
          fileName: params.fileName,
          ruleStatus: params.ruleStatus,
        },
        signal
      )
    }
    case 'calculate_model': {
      const params = parseOracleEpcmInput(calculationSchema, input)
      return submit(
        params,
        'Calculation',
        params.jobName,
        {
          modelName: params.modelName,
          povName: params.povName,
          povDelimiter: params.povDelimiter,
          executionType: params.executionType,
          ...(params.executionType === 'RULESET_SUBSET'
            ? {
                rulesetSeqNumStart: params.rulesetSeqNumStart,
                rulesetSeqNumEnd: params.rulesetSeqNumEnd,
              }
            : params.executionType !== 'ALL_RULES'
              ? { ruleName: params.ruleName }
              : {}),
          clearCalculatedData: String(params.clearCalculatedData ?? false),
          executeCalculations: String(params.executeCalculations ?? true),
          optimizeForReporting: String(params.optimizeForReporting ?? false),
          captureDebugScripts: String(params.captureDebugScripts ?? false),
          comment: params.comment,
        },
        signal
      )
    }
    case 'clear_pov': {
      const params = parseOracleEpcmInput(
        jobSchema.extend({
          ...povShape,
          cubeName: epcmName,
          clearInput: epcmBoolean,
          clearAllocatedValues: epcmBoolean,
          clearAdjustmentValues: epcmBoolean,
        }),
        input
      )
      return submit(
        params,
        'Clear POV',
        params.jobName,
        {
          povName: params.povName,
          povDelimiter: params.povDelimiter,
          cubeName: params.cubeName,
          clearInput: String(params.clearInput ?? false),
          clearAllocatedValues: String(params.clearAllocatedValues ?? false),
          clearAdjustmentValues: String(params.clearAdjustmentValues ?? false),
        },
        signal
      )
    }
    case 'copy_pov': {
      const params = parseOracleEpcmInput(
        jobSchema.extend({
          povDelimiter: povShape.povDelimiter,
          sourcePOVName: epcmName,
          destPOVName: epcmName,
          sourceCubeName: epcmName,
          destCubeName: epcmName,
          copyType: z.enum(['ALL_DATA', 'INPUT']),
        }),
        input
      )
      return submit(
        params,
        'Copy POV',
        params.jobName,
        {
          povDelimiter: params.povDelimiter,
          sourcePOVName: params.sourcePOVName,
          destPOVName: params.destPOVName,
          sourceCubeName: params.sourceCubeName,
          destCubeName: params.destCubeName,
          copyType: params.copyType,
        },
        signal
      )
    }
    case 'delete_pov': {
      const params = parseOracleEpcmInput(jobSchema.extend(povShape), input)
      return submit(
        params,
        'Delete POV',
        params.jobName,
        { povName: params.povName, povDelimiter: params.povDelimiter },
        signal
      )
    }
    case 'import_data': {
      const params = parseOracleEpcmInput(
        exchangeSchema.extend({
          sourceType: z.preprocess(
            (v) => (v === '' ? undefined : v),
            z.enum(['Planning', 'Essbase']).optional()
          ),
          cubeName: epcmOptionalString,
          delimiter: z.enum(['comma', 'tab']).optional(),
          includeMetaData: epcmBoolean,
          stopOnError: epcmBoolean,
        }),
        input
      )
      if (
        !params.jobName &&
        (!params.fileName ||
          !params.sourceType ||
          (params.sourceType === 'Essbase' && !params.cubeName))
      ) {
        throw new OracleEpcmOperationError(
          'Ad hoc data import requires fileName, sourceType, and a cube for Essbase'
        )
      }
      return submit(
        params,
        'IMPORT_DATA',
        params.jobName,
        {
          importFileName: params.fileName,
          sourceType: params.sourceType,
          cube: params.cubeName,
          delimiter: params.delimiter,
          includeMetaData: params.includeMetaData,
          stopOnError: params.stopOnError,
        },
        signal
      )
    }
    case 'export_data': {
      const params = parseOracleEpcmInput(
        exchangeSchema.extend({
          cubeName: epcmOptionalString,
          rowMembers: epcmOptionalString,
          columnMembers: epcmOptionalString,
          povMembers: epcmOptionalString,
          delimiter: z.enum(['comma', 'tab']).optional(),
          includeDynamicMembers: epcmBoolean,
          exportDataDecimalScale: epcmNumber(0, 16),
        }),
        input
      )
      if (
        !params.jobName &&
        (!params.cubeName || !params.rowMembers || !params.columnMembers || !params.povMembers)
      ) {
        throw new OracleEpcmOperationError(
          'Ad hoc data export requires cubeName, rowMembers, columnMembers, and povMembers'
        )
      }
      return submit(
        params,
        'EXPORT_DATA',
        params.jobName,
        {
          exportFileName: params.fileName,
          cube: params.cubeName,
          rowMembers: params.rowMembers,
          columnMembers: params.columnMembers,
          povMembers: params.povMembers,
          delimiter: params.delimiter,
          includeDynamicMembers: params.includeDynamicMembers,
          exportDataDecimalScale: params.exportDataDecimalScale,
        },
        signal
      )
    }
    case 'import_metadata':
    case 'export_metadata': {
      const params = parseOracleEpcmInput(
        exchangeSchema.extend({ jobName: epcmName, refreshCube: epcmBoolean }),
        input
      )
      return submit(
        params,
        operation.toUpperCase(),
        params.jobName,
        operation === 'import_metadata'
          ? {
              importZipFileName: params.fileName,
              refreshCube: params.refreshCube,
            }
          : { exportZipFileName: params.fileName },
        signal
      )
    }
    case 'export_data_slice': {
      const params = parseOracleEpcmInput(
        epcmApplicationSchema.extend({
          cubeName: epcmName,
          gridDefinition: z.unknown(),
        }),
        input
      )
      const gridDefinition = parseGridInput(
        epcmGridDefinitionSchema,
        params.gridDefinition,
        'Grid definition'
      )
      const data = await requestOracleEpcmJson(oracleEpcmClient(params), exportSliceEndpoint, {
        pathParams: { applicationName: params.applicationName, cubeName: params.cubeName },
        json: { exportPlanningData: false, gridDefinition },
        signal,
      })
      return { success: true, output: { grid: normalizeOracleEpcmExportGrid(data) } }
    }
    case 'import_data_slice': {
      const params = parseOracleEpcmInput(
        epcmApplicationSchema.extend({
          cubeName: epcmName,
          dataGrid: z.unknown(),
          aggregateEssbaseData: epcmBoolean,
          strictDateValidation: epcmBoolean,
          dateFormat: z
            .enum([
              'MM-DD-YYYY',
              'DD-MM-YYYY',
              'YYYY-MM-DD',
              'MM/DD/YYYY',
              'DD/MM/YYYY',
              'YYYY/MM/DD',
            ])
            .optional(),
        }),
        input
      )
      const dataGrid = parseGridInput(epcmDataGridSchema, params.dataGrid, 'Data grid')
      const data = await requestOracleEpcmJson(oracleEpcmClient(params), importSliceEndpoint, {
        pathParams: { applicationName: params.applicationName, cubeName: params.cubeName },
        json: optionalParameters({
          dataGrid,
          aggregateEssbaseData: params.aggregateEssbaseData ?? false,
          strictDateValidation: params.strictDateValidation ?? true,
          cellNotesOption: 'Skip',
          dateFormat: params.dateFormat,
        }),
        signal,
      })
      const output = normalizeOracleEpcmImportResult(data)
      return {
        success: output.numRejectedCells === 0,
        output,
        retryable: false,
        ...(output.numRejectedCells > 0
          ? { error: 'Oracle rejected cells; the accepted cells may already have been written' }
          : {}),
      }
    }
    default:
      throw new OracleEpcmOperationError('Unsupported Oracle EPCM operation')
  }
}
