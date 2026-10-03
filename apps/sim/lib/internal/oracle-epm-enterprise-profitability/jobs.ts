import { isPlainRecord } from '@sim/utils/object'
import { z } from 'zod'
import {
  oracleEpmLiteral as literal,
  type OracleEpmClient,
  oracleEpmQuery,
  oracleEpmPathParameter as parameter,
  pollOracleEpmJob,
} from '@/lib/internal/oracle-epm'
import {
  EPCM_EXCHANGE_JOB_TYPES,
  epcmDiagnosticPageSchema,
  epcmMessagePageSchema,
  normalizeOracleEpcmJob,
  OracleEpcmOperationError,
  requireOracleEpcmResponse,
} from '@/lib/internal/oracle-epm-enterprise-profitability/normalizers'
import {
  epcmApplicationPath,
  epcmApplicationSchema,
  epcmJsonPolicy,
  epcmNumber,
  epcmPlanningRoutes,
  oracleEpcmClient,
  parseOracleEpcmInput,
  requestOracleEpcmJson,
} from '@/lib/internal/oracle-epm-enterprise-profitability/operations'
import type {
  OracleEpcmJob,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'

const jobId = z.preprocess(
  (value) => (typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value),
  z.string().regex(/^(0|[1-9]\d{0,15})$/)
)
const jobSchema = epcmApplicationSchema.extend({ jobId })
const jobPath = [
  ...epcmApplicationPath,
  literal('jobs'),
  parameter('jobId', { maxBytes: 16, pattern: /^(0|[1-9]\d{0,15})$/ }),
]
const diagnosticsQuery = {
  offset: oracleEpmQuery.integer({ minimum: 0, maximum: 1_000_000 }),
  limit: oracleEpmQuery.integer({ minimum: 1, maximum: 1_000 }),
  q: oracleEpmQuery.string({
    maxBytes: 100,
    pattern: /^\{"messageType":"(ERROR|WARNING|INFO)"\}$/,
  }),
}
const statusEndpoint = epcmPlanningRoutes.defineEndpoint({
  ...epcmJsonPolicy,
  method: 'GET',
  body: 'none',
  path: jobPath,
})
const detailsEndpoint = epcmPlanningRoutes.defineEndpoint({
  ...epcmJsonPolicy,
  method: 'GET',
  body: 'none',
  path: [...jobPath, literal('details')],
  query: diagnosticsQuery,
})
const childDetailsEndpoint = epcmPlanningRoutes.defineEndpoint({
  ...epcmJsonPolicy,
  method: 'GET',
  body: 'none',
  path: [
    ...jobPath,
    literal('childjobs'),
    parameter('childJobId', { maxBytes: 16, pattern: /^(0|[1-9]\d{0,15})$/ }),
    literal('details'),
  ],
  query: diagnosticsQuery,
})
const childDetailsPolicy = epcmPlanningRoutes.defineReturnedLinkPolicy({
  relation: 'child-job-details',
  method: 'GET',
  endpoint: childDetailsEndpoint,
  preserveGatewayBasePath: true,
})

/** A validated child link contributes an ID only, never an unrestricted tool URL. */
export function oracleEpcmChildJobIds(
  links: readonly unknown[] | null | undefined,
  client: OracleEpmClient,
  applicationName: string,
  parentJobId: string
): string[] {
  const ids = new Set<string>()
  for (const link of links ?? []) {
    if (!isPlainRecord(link) || link.rel !== 'child-job-details') continue
    if (typeof link.href !== 'string' || link.action !== 'GET') {
      throw new OracleEpcmOperationError('Oracle returned malformed child-job details', 502)
    }
    client.validateReturnedLink(childDetailsPolicy, {
      rel: link.rel,
      href: link.href,
      method: link.action,
    })
    /** Foundation validates origin, gateway, encoding, query, and route before this binding check. */
    const segments = new URL(link.href).pathname.split('/').map(decodeURIComponent)
    const childId = segments.at(-2)
    if (
      segments.at(-6) !== applicationName ||
      segments.at(-4) !== parentJobId ||
      !childId ||
      !jobId.safeParse(childId).success
    ) {
      throw new OracleEpcmOperationError(
        'Oracle returned child details for a different application or job',
        502
      )
    }
    ids.add(childId)
  }
  return [...ids]
}

async function readJob(
  client: OracleEpmClient,
  applicationName: string,
  expectedJobId: string,
  signal?: AbortSignal
): Promise<OracleEpcmJob> {
  const job = normalizeOracleEpcmJob(
    await requestOracleEpcmJson(client, statusEndpoint, {
      pathParams: { applicationName, jobId: expectedJobId },
      signal,
    })
  )
  if (job.jobId !== expectedJobId)
    throw new OracleEpcmOperationError('Oracle returned a different job ID', 502)
  return job
}

export async function executeOracleEpcmJobOperation(
  operation: string,
  input: unknown,
  signal?: AbortSignal
): Promise<OracleEpcmResponse> {
  signal?.throwIfAborted()
  const params = parseOracleEpcmInput(jobSchema, input)
  const client = oracleEpcmClient(params)
  if (operation === 'get_job_status') {
    return {
      success: true,
      output: await readJob(client, params.applicationName, params.jobId, signal),
    }
  }
  if (operation === 'wait_for_job') {
    const { maxWaitSeconds } = parseOracleEpcmInput(
      jobSchema.extend({
        maxWaitSeconds: epcmNumber(1, 3_600, 300),
      }),
      input
    )
    const result = await pollOracleEpmJob<OracleEpcmJob, OracleEpcmJob, OracleEpcmJob>({
      read: (pollSignal) => readJob(client, params.applicationName, params.jobId, pollSignal),
      classify: (job) =>
        job.state === 'pending'
          ? { state: 'pending' }
          : job.state === 'succeeded'
            ? { state: 'success', result: job }
            : { state: 'failure', error: job },
      signal,
      maxWaitMs: (maxWaitSeconds ?? 300) * 1_000,
      cleanupReserveMs: 100,
      maxAttempts: 1_000,
      initialDelayMs: 1_000,
      maxDelayMs: 10_000,
    })
    return {
      success: result.state === 'success',
      output: {
        ...(result.state === 'success' ? result.result : result.error),
        attempts: result.attempts,
      },
      retryable: false,
      ...(result.state === 'failure'
        ? { error: 'Oracle EPCM job failed; it was not resubmitted' }
        : {}),
    }
  }
  const details = parseOracleEpcmInput(
    jobSchema.extend({
      jobType:
        operation === 'get_child_job_details'
          ? z.enum(['IMPORT_METADATA', 'EXPORT_METADATA'])
          : z.enum(EPCM_EXCHANGE_JOB_TYPES),
      childJobId: operation === 'get_child_job_details' ? jobId : jobId.optional(),
      offset: epcmNumber(0, 1_000_000, 0),
      limit: epcmNumber(1, 1_000, 25),
      messageType: z.preprocess(
        (value) => (value === '' ? undefined : value),
        z.enum(['ERROR', 'WARNING', 'INFO']).optional()
      ),
    }),
    input
  )
  const offset = details.offset ?? 0
  const limit = details.limit ?? 25
  const query = {
    offset,
    limit,
    ...(details.messageType ? { q: JSON.stringify({ messageType: details.messageType }) } : {}),
  }
  if (operation === 'get_job_details') {
    const data = requireOracleEpcmResponse(
      epcmDiagnosticPageSchema,
      await requestOracleEpcmJson(client, detailsEndpoint, {
        pathParams: { applicationName: params.applicationName, jobId: params.jobId },
        query,
        signal,
      })
    )
    return {
      success: true,
      output: {
        details: data.items.map(({ links, ...item }) => ({
          ...item,
          childJobIds: oracleEpcmChildJobIds(links, client, params.applicationName, params.jobId),
        })),
        offset,
        limit,
      },
    }
  }
  if (operation === 'get_child_job_details' && details.childJobId) {
    const data = requireOracleEpcmResponse(
      epcmMessagePageSchema,
      await requestOracleEpcmJson(client, childDetailsEndpoint, {
        pathParams: {
          applicationName: params.applicationName,
          jobId: params.jobId,
          childJobId: details.childJobId,
        },
        query,
        signal,
      })
    )
    return { success: true, output: { messages: data.items, offset, limit } }
  }
  throw new OracleEpcmOperationError('Unsupported Oracle EPCM job operation')
}
