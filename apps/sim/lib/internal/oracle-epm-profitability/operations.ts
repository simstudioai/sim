import { filterUndefined, isPlainRecord, omit } from '@sim/utils/object'
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
  normalizeOraclePcmTask,
  OraclePcmOperationError,
  PCM_MAX_ITEMS,
  PCM_MAX_JSON_BYTES,
  pcmBalanceSchema,
  pcmFileName,
  pcmName,
  pcmStatusSchema,
  requireOraclePcmResponse,
} from '@/lib/internal/oracle-epm-profitability/normalizers'
import type { OraclePcmResponse, OraclePcmTask } from '@/tools/oracle_epm_profitability/types'
import { parseOraclePcmBoolean } from '@/tools/oracle_epm_profitability/utils'

export const pcmRoutes = defineOracleEpmRouteSpace({
  context: ['epm', 'rest'],
  allowedVersions: ['v1'],
})
export const pcmJsonPolicy = {
  version: 'v1',
  response: 'json',
  timeoutMs: 30_000,
  maxResponseBytes: PCM_MAX_JSON_BYTES,
} as const
export const pcmTaskEndpoint = pcmRoutes.defineEndpoint({
  ...pcmJsonPolicy,
  method: 'GET',
  body: 'none',
  path: [
    literal('applications'),
    literal('jobs'),
    literal('ChecktaskStatusJob'),
    parameter('processName', { maxBytes: 255 }),
  ],
})
const taskLinkPolicy = pcmRoutes.defineReturnedLinkPolicy({
  endpoint: pcmTaskEndpoint,
  relation: 'Job Status',
  method: 'GET',
  preserveGatewayBasePath: true,
})

/** The program-documentation details field is prose, so only a validated task link supplies an ID. */
export function normalizeOraclePcmSubmission(
  value: unknown,
  client: OracleEpmClient
): OraclePcmTask {
  const data = requireOraclePcmResponse(
    pcmStatusSchema.extend({
      links: z
        .array(
          z.object({
            rel: z.string().max(255).optional(),
            href: z.string().max(8_192),
            action: z.string().max(16),
          })
        )
        .max(32)
        .optional(),
    }),
    value
  )
  const links = (data.links ?? []).filter((link) => link.rel === 'Job Status')
  if (links.length > 1 || (data.status === -1 && links.length !== 1)) {
    throw new OraclePcmOperationError(
      'Oracle PCM omitted a unique task status link; inspect the Job Library before resubmitting',
      502
    )
  }
  let processName: string | null = null
  if (links.length === 1) {
    const link = links[0]
    client.validateReturnedLink(taskLinkPolicy, {
      rel: 'Job Status',
      href: link.href,
      method: link.action,
    })
    processName = decodeURIComponent(new URL(link.href).pathname.split('/').at(-1) ?? '')
    requireOraclePcmResponse(pcmName, processName)
  }
  return normalizeOraclePcmTask(data, processName)
}
export const pcmAuthSchema = z.object({
  oauthCredential: pcmName,
  accessToken: z.string().min(1).max(4_096),
  instanceUrl: z.string().min(1).max(4_096),
})
const applicationSchema = pcmAuthSchema.extend({ applicationName: pcmName })
const optionalText = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().max(4_096).optional()
)
const optionalName = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  pcmName.optional()
)
const boolean = z.preprocess(parseOraclePcmBoolean, z.boolean().optional())
const requiredBoolean = z.preprocess(parseOraclePcmBoolean, z.boolean())
export const pcmNumber = (minimum: number, maximum: number, fallback?: number) =>
  z.preprocess(
    (value) =>
      value === '' || value === undefined || value === null
        ? fallback
        : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)
          ? Number(value)
          : value,
    z.number().finite().min(minimum).max(maximum).optional()
  )
const sequence = pcmNumber(0, 2_147_483_647)
const delimiter = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().length(1).optional()
)

export function parseOraclePcmInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const values = isPlainRecord(value)
    ? filterUndefined(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, item === '' ? undefined : item])
        )
      )
    : value
  const parsed = schema.safeParse(values)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new OraclePcmOperationError(
      `Invalid PCM input ${issue?.path.join('.') || 'parameters'}: ${issue?.message || 'validation failed'}`
    )
  }
  return parsed.data
}

export function oraclePcmClient(input: unknown): OracleEpmClient {
  return createOracleEpmClient(parseOraclePcmInput(pcmAuthSchema, input))
}

export async function requestOraclePcmJson(
  client: OracleEpmClient,
  endpoint: OracleEpmEndpoint,
  input: Parameters<OracleEpmClient['request']>[1]
): Promise<unknown> {
  const response = await client.request(endpoint, input)
  if (!('data' in response))
    throw new OraclePcmOperationError('Oracle PCM returned an unexpected response type', 502)
  return response.data
}

const appPath = [literal('applications'), parameter('applicationName', { maxBytes: 255 })]
const fileAppPath = [literal('fileApplications'), parameter('applicationName', { maxBytes: 255 })]
const povPath = [...appPath, literal('povs'), parameter('povName', { maxBytes: 255 })]
const post = (path: Parameters<typeof pcmRoutes.defineEndpoint>[0]['path']) =>
  pcmRoutes.defineEndpoint({
    ...pcmJsonPolicy,
    method: 'POST',
    path,
    body: 'json',
    maxRequestBytes: PCM_MAX_JSON_BYTES,
  })

/** Product contracts from Oracle's PCM REST chapter; these are not EPCM job types. */
const endpoints = {
  create_application: post(fileAppPath),
  enable_application: post([...fileAppPath, literal('enableApplication')]),
  deploy_cube: post([...appPath, literal('jobs'), literal('ledgerDeployCubeJob')]),
  update_dimensions: post([...fileAppPath, literal('jobs'), literal('updateDimension')]),
  load_data: post([...appPath, literal('jobs'), literal('essbaseDataLoadJob')]),
  run_calculation: post([...povPath, literal('jobs'), literal('runLedgerCalculationJob')]),
  copy_pov: post([
    ...povPath,
    literal('jobs'),
    literal('copyPOVJob'),
    parameter('destinationPovName', { maxBytes: 255 }),
  ]),
  clear_pov: post([...povPath, literal('jobs'), literal('clearPOVJob')]),
  generate_program_documentation: post([
    ...povPath,
    literal('jobs'),
    literal('programDocReportJob'),
  ]),
  export_query_results: post([...appPath, literal('jobs'), literal('exportQueryResultsJob')]),
  import_template: post([...appPath, literal('jobs'), literal('templateImportJob')]),
  apply_data_grants: post([...appPath, literal('jobs'), literal('applyDataGrants')]),
  merge_slices: post([...appPath, literal('jobs'), literal('mergeSlices')]),
  optimize_cube: post([...appPath, literal('jobs'), literal('optimizeASOCube')]),
}
const balanceEndpoint = pcmRoutes.defineEndpoint({
  ...pcmJsonPolicy,
  method: 'GET',
  path: [...povPath, literal('ruleBalance')],
  body: 'none',
  query: { queryParameter: oracleEpmQuery.string({ required: true, maxBytes: 4_096 }) },
})
const povSchema = applicationSchema.extend({ povName: pcmName, stringDelimiter: delimiter })
const schemas = {
  create_application: applicationSchema.extend({
    description: z.string().max(4_096),
    ruleDimensionName: pcmName,
    balanceDimensionName: pcmName,
  }),
  enable_application: applicationSchema,
  deploy_cube: applicationSchema
    .extend({
      isKeepData: requiredBoolean,
      isReplaceCube: requiredBoolean,
      comment: z.string().max(4_096),
    })
    .refine(
      (p) => !(p.isKeepData && p.isReplaceCube),
      'Preserving data and replacing the cube cannot both be true'
    ),
  update_dimensions: applicationSchema.extend({
    dataFileName: z.string().trim().min(1).max(4_096),
    stringDelimiter: delimiter,
    acceptableDecreasePercentage: pcmNumber(0, 100),
  }),
  load_data: applicationSchema.extend({
    clearAllDataFlag: requiredBoolean,
    dataLoadValue: z.enum(['ADD_EXISTING_VALUES', 'OVERWRITE_EXISTING_VALUES']),
    dataFileName: pcmFileName,
  }),
  run_calculation: povSchema
    .extend({
      exeType: z.enum(['ALL_RULES', 'RULESET_SUBSET', 'SINGLE_RULE']),
      dataPOVName: optionalName,
      isClearCalculated: boolean,
      optimizeReporting: boolean,
      subsetStart: sequence,
      subsetEnd: sequence,
      ruleName: optionalName,
      ruleSetName: optionalName,
      comment: optionalText,
    })
    .superRefine((p, ctx) => {
      if (p.dataPOVName && p.exeType !== 'ALL_RULES') {
        ctx.addIssue({
          code: 'custom',
          path: ['dataPOVName'],
          message: 'A different data POV requires ALL_RULES',
        })
      }
      if (p.exeType === 'SINGLE_RULE' && (!p.ruleName || !p.ruleSetName)) {
        ctx.addIssue({
          code: 'custom',
          path: ['ruleName'],
          message: 'SINGLE_RULE requires ruleName and ruleSetName',
        })
      }
      if (
        p.exeType === 'RULESET_SUBSET' &&
        (p.subsetStart === undefined || p.subsetEnd === undefined || p.subsetStart > p.subsetEnd)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['subsetStart'],
          message: 'RULESET_SUBSET requires an ordered start/end range',
        })
      }
    }),
  copy_pov: povSchema.extend({
    destinationPovName: pcmName,
    isManageRule: requiredBoolean,
    isInputData: requiredBoolean,
    createDestPOV: requiredBoolean,
    modelViewName: optionalName,
    nonEmptyTupleEnabled: boolean,
    stringDelimiter: z.string().length(1),
  }),
  clear_pov: povSchema
    .extend({
      isManageRule: boolean,
      isInputData: boolean,
      isAllocatedValues: boolean,
      isAdjustmentValues: boolean,
      queryName: optionalName,
    })
    .refine(
      (p) => !p.queryName || !(p.isManageRule || p.isAllocatedValues || p.isAdjustmentValues),
      'Query clearing cannot clear rules, allocations, or adjustments'
    ),
  generate_program_documentation: povSchema.extend({
    fileName: pcmFileName.optional(),
    fileType: z.enum(['PDF', 'XML', 'WORD', 'EXCEL', 'HTML']).optional(),
    skipFilters: boolean,
    subsetStart: sequence,
    subsetEnd: sequence,
    useAlias: boolean,
  }),
  export_query_results: applicationSchema.extend({
    fileName: pcmFileName,
    queryName: optionalName,
    exportOnlyLevel0Flg: boolean,
    fileOutputOptions: z.enum(['ZIP_ONLY', 'ZIP_AND_TEXT', 'TEXT_ONLY']).optional(),
    roundingPrecision: pcmNumber(0, Number.MAX_SAFE_INTEGER).pipe(z.number().int().optional()),
    dataFormat: z.enum(['NATIVE', 'COLUMNAR']).optional(),
    memberFilters: z.string().max(65_536).optional(),
    includeHeader: boolean,
    delimiter,
    keepDuplicateMemberFormat: boolean,
  }),
  import_template: applicationSchema.extend({
    description: z.string().max(4_096),
    fileName: pcmFileName,
    isApplicationOverwrite: requiredBoolean,
  }),
  apply_data_grants: applicationSchema,
  merge_slices: applicationSchema.extend({ removeZeroCells: boolean }),
  optimize_cube: applicationSchema.extend({
    type: z.enum([
      'clearAggregations',
      'createAggregations',
      'startQueryTracking',
      'stopQueryTracking',
      'createQBOAggregations',
    ]),
  }),
}

export async function executeOraclePcmOperation(
  operation: string,
  input: unknown,
  signal?: AbortSignal
): Promise<OraclePcmResponse> {
  signal?.throwIfAborted()
  if (operation === 'get_rule_balancing') {
    const p = parseOraclePcmInput(povSchema.extend({ modelViewName: pcmName }), input)
    const data = requireOraclePcmResponse(
      pcmStatusSchema.extend({ items: z.array(pcmBalanceSchema).max(PCM_MAX_ITEMS).optional() }),
      await requestOraclePcmJson(oraclePcmClient(p), balanceEndpoint, {
        pathParams: { applicationName: p.applicationName, povName: p.povName },
        query: {
          queryParameter: JSON.stringify(
            filterUndefined({ modelViewName: p.modelViewName, stringDelimiter: p.stringDelimiter })
          ),
        },
        signal,
      })
    )
    if (data.status !== 0)
      throw new OraclePcmOperationError('Oracle PCM rule balancing failed', 502)
    if (!data.items)
      throw new OraclePcmOperationError('Oracle PCM omitted rule balancing items', 502)
    return { success: true, output: { items: data.items, status: data.status } }
  }
  if (!Object.hasOwn(schemas, operation)) {
    throw new OraclePcmOperationError('Unsupported Oracle PCM operation')
  }
  const key = operation as keyof typeof schemas
  const p = parseOraclePcmInput(schemas[key] as z.ZodType<Record<string, unknown>>, input)
  const pathParams: Record<string, string> = { applicationName: p.applicationName as string }
  if (typeof p.povName === 'string') pathParams.povName = p.povName
  if (typeof p.destinationPovName === 'string') pathParams.destinationPovName = p.destinationPovName
  let body = omit(p, [
    'oauthCredential',
    'accessToken',
    'instanceUrl',
    'applicationName',
    'povName',
    'destinationPovName',
  ])
  if (key === 'run_calculation' || key === 'deploy_cube') body.isRunNow = true
  if (key === 'run_calculation') {
    body.isExecuteCalculations = true
    if (body.exeType !== 'RULESET_SUBSET') body = omit(body, ['subsetStart', 'subsetEnd'])
    if (body.exeType !== 'SINGLE_RULE') body = omit(body, ['ruleName', 'ruleSetName'])
  }
  if (key === 'export_query_results' && typeof body.memberFilters === 'string') {
    let filters: unknown
    try {
      filters = JSON.parse(body.memberFilters)
    } catch {
      throw new OraclePcmOperationError(
        'memberFilters must be a JSON object of dimension names to level-0 member arrays'
      )
    }
    parseOraclePcmInput(
      z
        .record(pcmName, z.array(pcmName).min(1).max(1_000))
        .refine((v) => Object.keys(v).length <= 100),
      filters
    )
  }
  /** Match documented PCM string scalar payloads; report examples use native booleans. */
  const json = Object.fromEntries(
    Object.entries(filterUndefined(body)).map(([name, value]) => [
      name,
      (typeof value === 'boolean' && key !== 'generate_program_documentation') ||
      typeof value === 'number'
        ? String(value)
        : value,
    ])
  )
  const client = oraclePcmClient(p)
  const output = normalizeOraclePcmSubmission(
    await requestOraclePcmJson(client, endpoints[key], { pathParams, json, signal }),
    client
  )
  return {
    success: output.state !== 'failed',
    output,
    retryable: false,
    ...(output.state === 'failed'
      ? { error: 'Oracle PCM rejected the task; inspect its status and details before retrying' }
      : {}),
  }
}
