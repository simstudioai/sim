import type { z } from 'zod'
import type {
  OracleEpmClient,
  OracleEpmEndpoint,
  OracleEpmPollClassification,
  OracleEpmRequestInput,
  OracleEpmReturnedLinkPolicy,
} from '@/lib/internal/oracle-epm'
import {
  openOracleEpmSourceFile,
  pollOracleEpmJob,
  storeOracleEpmDownload,
} from '@/lib/internal/oracle-epm'
import {
  createTaxReportingClient,
  TAX_DOWNLOAD_BYTES,
  TAX_UPLOAD_BYTES,
  taxEndpoints,
  taxLinkPolicies,
} from '@/lib/internal/oracle-epm-tax-reporting/client'
import type { TaxInput, TaxJobResult } from '@/lib/internal/oracle-epm-tax-reporting/schema'
import {
  apiVersionSchema,
  applicationListSchema,
  childJobDetailsSchema,
  clearSliceResponseSchema,
  dataGridSchema,
  fileListSchema,
  importSliceResponseSchema,
  jobDefinitionsSchema,
  jobDetailsSchema,
  jobResponseSchema,
  memberResponseSchema,
  reportResponseSchema,
  statusResponseSchema,
  supplementalResponseSchema,
} from '@/lib/internal/oracle-epm-tax-reporting/schema'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type { UserFile } from '@/executor/types'

export class TaxReportingContractError extends Error {}

/** Omit absent optional wire fields; the foundation accepts JSON values, not undefined. */
function wireJson(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error('Tax Reporting request nesting exceeds the supported depth')
  if (Array.isArray(value)) return value.map((item) => wireJson(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, wireJson(item, depth + 1)])
    )
  }
  return value
}

function project<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success)
    throw new TaxReportingContractError(`Tax Reporting returned an invalid ${label} response`)
  return parsed.data
}

async function readJson<T>(
  client: OracleEpmClient,
  endpoint: OracleEpmEndpoint,
  schema: z.ZodType<T>,
  input: OracleEpmRequestInput = {}
): Promise<T> {
  const response = await client.request(
    endpoint,
    input.json === undefined ? input : { ...input, json: wireJson(input.json) }
  )
  if (!('data' in response))
    throw new TaxReportingContractError('Tax Reporting did not return JSON')
  return project(schema, response.data, 'API')
}

/** Selectors and tools deliberately share the same bounded discovery contracts. */
export function listTaxApplications(client: OracleEpmClient, signal?: AbortSignal) {
  return readJson(client, taxEndpoints.list_applications, applicationListSchema, { signal })
}
export function listTaxJobDefinitions(
  client: OracleEpmClient,
  application: string,
  jobType?: string,
  signal?: AbortSignal
) {
  return readJson(client, taxEndpoints.list_job_definitions, jobDefinitionsSchema, {
    pathParams: { application },
    query: jobType ? { q: JSON.stringify({ jobType }) } : {},
    signal,
  })
}

/** Local waiting never cancels the Oracle job; pending cancellation is not a completed job. */
export function classifyTaxJob(
  job: TaxJobResult,
  planning = false
): OracleEpmPollClassification<TaxJobResult, TaxJobResult> {
  if (job.status === -1 || (planning && job.status === 2)) return { state: 'pending' as const }
  if (job.status === 0) return { state: 'success' as const, result: job }
  return { state: 'failure' as const, error: job }
}

async function waitForJob(
  initial: TaxJobResult,
  read: (signal: AbortSignal) => Promise<TaxJobResult>,
  signal?: AbortSignal,
  planning = false
) {
  if (classifyTaxJob(initial, planning).state !== 'pending') return initial
  let latest = initial
  try {
    const result = await pollOracleEpmJob({
      read: async (pollSignal) => {
        const snapshot = await read(pollSignal)
        latest = { ...initial, ...snapshot, jobId: snapshot.jobId ?? initial.jobId }
        return latest
      },
      classify: (snapshot) => classifyTaxJob(snapshot, planning),
      signal,
      maxWaitMs: 120000,
      cleanupReserveMs: 5000,
      maxAttempts: 30,
      initialDelayMs: 1000,
      maxDelayMs: 5000,
    })
    return result.state === 'success' ? result.result : result.error
  } catch {
    signal?.throwIfAborted()
    // A local wait/read failure does not reverse acceptance or cancel the Oracle job.
    return { ...latest, waitOutcome: 'incomplete' as const }
  }
}

function jobPath(application: string | undefined, jobId: string): Record<string, string> {
  return application ? { application, jobId } : { jobId }
}

async function submitJob(
  client: OracleEpmClient,
  body: unknown,
  family: 'planning' | 'collection' | 'dimension',
  application: string | undefined,
  wait: boolean,
  signal?: AbortSignal
) {
  const endpoint =
    family === 'planning'
      ? taxEndpoints.submit_job
      : family === 'collection'
        ? taxEndpoints.submit_fcm_job
        : taxEndpoints.submit_sdm_job
  const statusEndpoint =
    family === 'planning'
      ? taxEndpoints.get_job_status
      : family === 'collection'
        ? taxEndpoints.get_fcm_job
        : taxEndpoints.get_sdm_job
  // Submit exactly once. In particular, do not wrap submission in the polling callback.
  const responseSchema = family === 'planning' ? jobResponseSchema : supplementalResponseSchema
  const job = await readJson(client, endpoint, responseSchema, {
    json: body,
    pathParams: application ? { application } : {},
    signal,
  })
  if (!job.jobId && classifyTaxJob(job, family === 'planning').state === 'pending') {
    throw new TaxReportingContractError(
      'Tax Reporting accepted a pending job without a documented job ID; do not resubmit automatically'
    )
  }
  return wait && job.jobId
    ? waitForJob(
        job,
        (pollSignal) =>
          readJson(client, statusEndpoint, responseSchema, {
            pathParams: jobPath(application, job.jobId!),
            signal: pollSignal,
          }),
        signal,
        family === 'planning'
      )
    : job
}

function getReportLink(
  client: OracleEpmClient,
  job: TaxJobResult,
  policy: OracleEpmReturnedLinkPolicy
) {
  const candidates = job.links?.filter((link) => link.rel === 'Job Status') ?? []
  if (candidates.length !== 1)
    throw new TaxReportingContractError(
      'Tax Reporting accepted a pending report without exactly one Job Status link; do not resubmit automatically'
    )
  const link = candidates[0]
  return client.validateReturnedLink(policy, {
    rel: 'Job Status',
    href: link.href,
    method: link.action,
  })
}

async function submitReport(
  client: OracleEpmClient,
  input: Extract<TaxInput, { operation: 'generate_report' | 'generate_user_details_report' }>,
  signal?: AbortSignal
) {
  const isReport = input.operation === 'generate_report'
  const body = isReport
    ? {
        groupName: input.groupName,
        reportName: input.reportName,
        generatedReportFileName: input.generatedReportFileName,
        parameters: input.parameters,
        format: input.format,
        module: input.module,
        runAsync: true,
      }
    : { fileName: input.fileName, format: input.format }
  const initial = await readJson(client, taxEndpoints[input.operation], reportResponseSchema, {
    json: body,
    signal,
  })
  if (classifyTaxJob(initial).state !== 'pending') return initial
  const link = getReportLink(
    client,
    initial,
    isReport ? taxLinkPolicies.reportJob : taxLinkPolicies.userReportJob
  )
  if (!input.waitForCompletion) return initial
  return waitForJob(
    initial,
    async (pollSignal) => {
      const response = await client.requestValidatedLink(link, pollSignal)
      if (!('data' in response))
        throw new TaxReportingContractError('Tax Reporting did not return a JSON report status')
      return project(reportResponseSchema, response.data, 'report status')
    },
    signal
  )
}

function fileContext(context: InternalToolOperationContext) {
  if (!context.workspaceId || !context.workflowId || !context.executionId) {
    throw new Error('Tax Reporting downloads require a trusted workflow execution context')
  }
  return {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
  }
}

async function storeDownload(
  response: Awaited<ReturnType<OracleEpmClient['request']>>,
  fileName: string,
  context: InternalToolOperationContext,
  signal?: AbortSignal
): Promise<UserFile> {
  if (!('body' in response))
    throw new TaxReportingContractError('Tax Reporting did not return a file stream')
  try {
    // Oracle's download API returns JSON for errors, even with an HTTP 200 response.
    if (/^application\/json(?:\s*;|$)/i.test(response.contentType ?? '')) {
      throw new TaxReportingContractError('Oracle rejected the file download (JSON error response)')
    }
    return await storeOracleEpmDownload({
      ...response,
      fileName,
      context: fileContext(context),
      maxBytes: TAX_DOWNLOAD_BYTES,
      signal,
    })
  } catch (error) {
    await response.body.cancel().catch(() => undefined)
    throw error
  }
}

async function downloadReport(
  client: OracleEpmClient,
  job: TaxJobResult,
  context: InternalToolOperationContext,
  signal?: AbortSignal
) {
  fileContext(context)
  const links = job.links?.filter((link) => link.rel === 'report-content') ?? []
  if (links.length !== 1)
    throw new TaxReportingContractError(
      'Tax Reporting did not return exactly one report-content link'
    )
  const link = links[0]
  let validated: ReturnType<OracleEpmClient['validateReturnedLink']> | undefined
  for (const policy of [taxLinkPolicies.repositoryReport, taxLinkPolicies.generatedReport]) {
    try {
      validated = client.validateReturnedLink(policy, {
        rel: 'report-content',
        href: link.href,
        method: link.action,
      })
      break
    } catch {
      /* Each alternative remains an exact, same-destination foundation policy. */
    }
  }
  if (!validated)
    throw new TaxReportingContractError(
      'Tax Reporting returned an unsupported or unsafe report download link'
    )
  const parts = new URL(link.href, 'https://validated-link.invalid').pathname.split('/')
  const filePart = parts.at(-1) === 'contents' ? parts.at(-2) : parts.at(-1)
  const fileName =
    decodeURIComponent(filePart ?? 'report')
      .split(/[/\\]/)
      .at(-1) ?? 'report'
  return storeDownload(
    await client.requestValidatedLink(validated, signal),
    fileName,
    context,
    signal
  )
}

/** Executes only the 27 registered, product-specific operations. No arbitrary URL or job passthrough. */
export async function executeTaxReportingOperation(
  input: TaxInput,
  context: InternalToolOperationContext,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const client = createTaxReportingClient(input)
  switch (input.operation) {
    case 'get_api_version':
      return readJson(client, taxEndpoints.get_api_version, apiVersionSchema, { signal })
    case 'list_applications':
      return listTaxApplications(client, signal)
    case 'list_job_definitions':
      return listTaxJobDefinitions(client, input.application, input.jobType, signal)
    case 'get_member':
      return readJson(client, taxEndpoints.get_member, memberResponseSchema, {
        pathParams: {
          application: input.application,
          dimension: input.dimension,
          memberName: input.memberName,
        },
        signal,
      })
    case 'add_member':
      return readJson(client, taxEndpoints.add_member, memberResponseSchema, {
        pathParams: { application: input.application, dimension: input.dimension },
        json: { memberName: input.memberName, parentName: input.parentName },
        signal,
      })
    case 'export_data_slice':
      return readJson(client, taxEndpoints.export_data_slice, dataGridSchema, {
        pathParams: { application: input.application, planType: input.planType },
        json: { gridDefinition: input.gridDefinition, exportPlanningData: false },
        signal,
      })
    case 'import_data_slice':
      return readJson(client, taxEndpoints.import_data_slice, importSliceResponseSchema, {
        pathParams: { application: input.application, planType: input.planType },
        json: {
          dataGrid: input.dataGrid,
          aggregateEssbaseData: input.aggregateEssbaseData,
          dateFormat: input.dateFormat,
          strictDateValidation: input.strictDateValidation,
          customParams: { IncludeRejectedCells: true, IncludeRejectedCellsWithDetails: true },
        },
        signal,
      })
    case 'clear_data_slice':
      return readJson(client, taxEndpoints.clear_data_slice, clearSliceResponseSchema, {
        pathParams: { application: input.application, planType: input.planType },
        json: {
          gridDefinition: input.gridDefinition,
          clearEssbaseData: input.clearEssbaseData,
          clearPlanningData: input.clearPlanningData,
        },
        signal,
      })
    case 'copy_data':
    case 'clear_data':
      return submitJob(
        client,
        {
          jobType: input.operation === 'copy_data' ? 'COPY_DATA' : 'CLEAR_DATA',
          jobName: 'Execute Profile',
          parameters: { ProfileName: input.profileName },
        },
        'planning',
        input.application,
        input.waitForCompletion,
        signal
      )
    case 'run_rule':
    case 'run_ruleset':
      return submitJob(
        client,
        {
          jobType: input.operation === 'run_rule' ? 'RULES' : 'RULESET',
          jobName: input.jobName,
          parameters: input.parameters,
        },
        'planning',
        input.application,
        input.waitForCompletion,
        signal
      )
    case 'execute_job': {
      const definitions = await listTaxJobDefinitions(
        client,
        input.application,
        input.jobType,
        signal
      )
      if (
        !definitions.items.some(
          (job) => job.jobName === input.jobName && job.jobType.toUpperCase() === input.jobType
        )
      ) {
        throw new Error(
          'The selected supported job definition was not found; use its exact deployed name and type'
        )
      }
      return submitJob(
        client,
        { jobType: input.jobType, jobName: input.jobName, parameters: input.parameters },
        'planning',
        input.application,
        input.waitForCompletion,
        signal
      )
    }
    case 'export_metadata':
      return submitJob(
        client,
        {
          jobType: 'EXPORT_METADATA',
          jobName: input.jobName,
          parameters: { exportZipFileName: input.exportZipFileName },
        },
        'planning',
        input.application,
        input.waitForCompletion,
        signal
      )
    case 'import_metadata':
      return submitJob(
        client,
        {
          jobType: 'IMPORT_METADATA',
          jobName: input.jobName,
          parameters: {
            importZipFileName: input.importZipFileName,
            refreshCube: input.refreshCube,
            errorFile: input.errorFile,
          },
        },
        'planning',
        input.application,
        input.waitForCompletion,
        signal
      )
    case 'get_job_status': {
      const endpoint =
        input.jobFamily === 'planning'
          ? taxEndpoints.get_job_status
          : input.jobFamily === 'supplemental_collection'
            ? taxEndpoints.get_fcm_job
            : taxEndpoints.get_sdm_job
      const pathParams = jobPath(
        input.jobFamily === 'supplemental_dimension' ? undefined : input.application,
        input.jobId
      )
      const read = (readSignal?: AbortSignal) =>
        readJson(
          client,
          endpoint,
          input.jobFamily === 'planning' ? jobResponseSchema : supplementalResponseSchema,
          { pathParams, signal: readSignal }
        )
      const job = await read(signal)
      return input.waitForCompletion
        ? waitForJob(job, read, signal, input.jobFamily === 'planning')
        : job
    }
    case 'get_job_details':
    case 'get_child_job_details': {
      const request = {
        pathParams: {
          application: input.application,
          jobId: input.jobId,
          ...(input.operation === 'get_child_job_details' ? { childJobId: input.childJobId } : {}),
        },
        query: {
          limit: input.limit,
          offset: input.offset,
          ...(input.messageType ? { q: JSON.stringify({ messageType: input.messageType }) } : {}),
        },
        signal,
      }
      return input.operation === 'get_job_details'
        ? readJson(client, taxEndpoints.get_job_details, jobDetailsSchema, request)
        : readJson(client, taxEndpoints.get_child_job_details, childJobDetailsSchema, request)
    }
    case 'import_supplemental_collection_data':
      return submitJob(
        client,
        {
          jobType: 'IMPORT_SUPPLEMENTAL_COLLECTION_DATA',
          jobName: input.jobName,
          parameters: {
            ...input.frequencyDimensions,
            fileName: input.fileName,
            collection: input.collection,
            year: input.year,
            period: input.period,
          },
        },
        'collection',
        input.application,
        input.waitForCompletion,
        signal
      )
    case 'deploy_form_templates':
      return submitJob(
        client,
        {
          jobType: 'DEPLOY_FORM_TEMPLATES',
          jobName: input.jobName,
          parameters: {
            ...input.frequencyDimensions,
            CollectionIntervalName: input.collectionIntervalName,
            Template: input.templates,
            ResetWorkflows: input.resetWorkflows,
          },
        },
        'collection',
        input.application,
        input.waitForCompletion,
        signal
      )
    case 'import_supplemental_dimension_members':
      return submitJob(
        client,
        {
          jobType: 'SDM_IMPORT_DIM_MEMBERS',
          parameters: {
            DimensionName: input.dimension,
            FileName: input.fileName,
            importMode: input.importMode,
            delimiter: input.delimiter,
            dateFormat: input.dateFormat,
          },
        },
        'dimension',
        undefined,
        input.waitForCompletion,
        signal
      )
    case 'generate_report':
    case 'generate_user_details_report':
      return submitReport(client, input, signal)
    case 'get_report_status': {
      if (input.downloadReport) fileContext(context)
      const endpoint =
        input.reportStatusRoute === 'standalone'
          ? taxEndpoints.get_report_status
          : input.reportStatusRoute === 'generated_report'
            ? taxEndpoints.get_generated_report_status
            : taxEndpoints.get_user_report_status
      const pathParams: Record<string, string> =
        input.reportStatusRoute === 'user_details'
          ? { jobId: input.jobId }
          : { jobId: input.jobId, module: input.module! }
      const read = (readSignal?: AbortSignal) =>
        readJson(client, endpoint, reportResponseSchema, { pathParams, signal: readSignal })
      const initial = await read(signal)
      const job = input.waitForCompletion ? await waitForJob(initial, read, signal) : initial
      return input.downloadReport && job.status === 0
        ? { ...job, file: await downloadReport(client, job, context, signal) }
        : job
    }
    case 'list_files':
      return readJson(client, taxEndpoints.list_files, fileListSchema, { signal })
    case 'upload_file': {
      if (!context.userId) throw new Error('Tax Reporting uploads require a trusted user context')
      const source = await openOracleEpmSourceFile({
        file: input.file as UserFile,
        userId: context.userId,
        maxBytes: TAX_UPLOAD_BYTES,
        signal,
      })
      // The foundation stream request accepts a bounded byte buffer, not an arbitrary URL.
      const chunks: Buffer[] = []
      for await (const chunk of source.chunks) chunks.push(chunk)
      return readJson(client, taxEndpoints.upload_file, statusResponseSchema, {
        pathParams: { fileName: input.fileName },
        query: input.directory ? { extDirPath: input.directory } : {},
        stream: Buffer.concat(chunks),
        signal,
      })
    }
    case 'download_file': {
      fileContext(context)
      const response = await client.request(taxEndpoints.download_file, {
        pathParams: { fileName: input.fileName },
        signal,
      })
      return {
        file: await storeDownload(
          response,
          input.fileName.split(/[/\\]/).at(-1) ?? input.fileName,
          context,
          signal
        ),
      }
    }
  }
}
