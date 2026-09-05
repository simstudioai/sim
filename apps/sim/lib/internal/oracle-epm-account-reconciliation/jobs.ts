import {
  type OracleEpmClient,
  type OracleEpmValidatedLink,
  pollOracleEpmJob,
} from '@/lib/internal/oracle-epm'
import {
  ArcsContractError,
  type ArcsJob,
  type ArcsLink,
  arcsFailure,
  arcsJobSchema,
  parseArcsResponse,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import {
  arcsArtifactPolicies,
  arcsJobLinkPolicies,
  arcsRoutes,
} from '@/lib/internal/oracle-epm-account-reconciliation/routes'
import type {
  OracleEpmAccountReconciliationJobOutput,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'

export type ArcsJobKind = keyof typeof arcsJobLinkPolicies

export function classifyArcsStatus(status: number): 'pending' | 'succeeded' | 'failed' {
  return status === -1 ? 'pending' : status === 0 ? 'succeeded' : 'failed'
}

/** Extract identifiers only after the foundation validates the entire returned URL. */
export function resolveArcsJobLink(
  client: OracleEpmClient,
  kind: ArcsJobKind,
  job: ArcsJob
): { jobId: string; link: OracleEpmValidatedLink } | undefined {
  const candidate =
    job.links?.find((link) => link.rel === 'Job Status') ??
    job.links?.find((link) => link.rel === 'self' && link.action === 'GET')
  if (!candidate) return undefined
  if (candidate.rel !== 'self' && candidate.rel !== 'Job Status') return undefined
  const link = client.validateReturnedLink(arcsJobLinkPolicies[kind][candidate.rel], {
    rel: candidate.rel,
    href: candidate.href,
    method: candidate.action,
  })
  const jobId = new URL(candidate.href).pathname.split('/').at(-1)
  if (!jobId) throw new ArcsContractError('Oracle EPM did not return a valid job ID')
  return { jobId, link }
}

/** Returns a repository filename only after validating its artifact relation and route. */
export function resolveArcsArtifact(
  client: OracleEpmClient,
  link: ArcsLink
): { fileName: string; link: OracleEpmValidatedLink } {
  if (link.rel !== 'log-content' && link.rel !== 'file-content' && link.rel !== 'report-content') {
    throw new ArcsContractError('Oracle EPM returned an unsupported artifact relation')
  }
  const validated = client.validateReturnedLink(arcsArtifactPolicies[link.rel], {
    rel: link.rel,
    href: link.href,
    method: link.action,
  })
  const encoded = new URL(link.href).pathname.split('/').at(-2)
  if (!encoded) throw new ArcsContractError('Oracle EPM did not return a valid artifact filename')
  return { fileName: decodeURIComponent(encoded), link: validated }
}

export function projectArcsJob(
  client: OracleEpmClient,
  kind: ArcsJobKind,
  job: ArcsJob,
  jobId?: string
): OracleEpmAccountReconciliationJobOutput {
  const output: OracleEpmAccountReconciliationJobOutput = {
    status: job.status,
    details: job.details ?? null,
    state: classifyArcsStatus(job.status),
    ...(jobId ? { jobId } : {}),
  }
  if (kind === 'matching') {
    for (const link of job.links ?? []) {
      if (link.rel === 'log-content')
        output.logFileName = resolveArcsArtifact(client, link).fileName
      if (link.rel === 'file-content')
        output.archiveFileName = resolveArcsArtifact(client, link).fileName
    }
  }
  return output
}

/** A status tool reads once and reports a remote failure as a successfully retrieved state. */
export async function readArcsJob(
  client: OracleEpmClient,
  kind: 'compliance' | 'matching',
  jobId: string,
  signal?: AbortSignal
): Promise<OracleEpmAccountReconciliationResponse> {
  const endpoint = kind === 'compliance' ? arcsRoutes.complianceJob : arcsRoutes.matchingJob
  const job = parseArcsResponse(
    arcsJobSchema,
    await client.request(endpoint, { pathParams: { jobId }, signal })
  )
  return { success: true, output: projectArcsJob(client, kind, job, jobId) }
}

/** Polling is shared; job states and limits belong to Account Reconciliation. */
export async function waitForArcsJob(
  client: OracleEpmClient,
  link: OracleEpmValidatedLink,
  maxWaitSeconds: number,
  signal?: AbortSignal
): Promise<ArcsJob> {
  const result = await pollOracleEpmJob<ArcsJob, ArcsJob, ArcsJob>({
    read: async (pollSignal) =>
      parseArcsResponse(arcsJobSchema, await client.requestValidatedLink(link, pollSignal)),
    classify: (job) =>
      job.status === -1
        ? { state: 'pending' }
        : job.status === 0
          ? { state: 'success', result: job }
          : { state: 'failure', error: job },
    signal,
    maxWaitMs: maxWaitSeconds * 1_000,
    cleanupReserveMs: 1_000,
    maxAttempts: 300,
    initialDelayMs: 1_000,
    maxDelayMs: 5_000,
  })
  return result.state === 'success' ? result.result : result.error
}

/** Launches exactly once, preserving accepted state when later polling or projection fails. */
export async function launchArcsJob(
  client: OracleEpmClient,
  kind: 'compliance' | 'matching',
  jobName: string,
  parameters: Record<string, unknown>,
  options: {
    waitForCompletion?: boolean
    maxWaitSeconds?: number
    periodStatus?: 'pending' | 'open' | 'closed' | 'locked'
  },
  signal?: AbortSignal
): Promise<OracleEpmAccountReconciliationResponse> {
  const endpoint = kind === 'compliance' ? arcsRoutes.complianceJobs : arcsRoutes.matchingJobs
  let output: OracleEpmAccountReconciliationResponse['output'] = {}
  try {
    const job = parseArcsResponse(
      arcsJobSchema,
      await client.request(endpoint, { json: { jobName, parameters }, signal })
    )
    output = {
      status: job.status,
      details: job.details ?? null,
      state: classifyArcsStatus(job.status),
    }
    if (job.status > 0) return { success: false, error: 'Oracle EPM rejected the job', output }
    output.accepted = true
    if (options.periodStatus) output.periodStatus = options.periodStatus
    if (options.periodStatus && options.periodStatus !== 'open') {
      return { success: true, output: { ...output, state: 'succeeded' } }
    }
    const resolved = resolveArcsJobLink(client, kind, job)
    if (resolved) output.jobId = resolved.jobId
    if (job.status === -1 && !resolved)
      throw new ArcsContractError(
        'Oracle EPM accepted the job but did not return a valid status link'
      )
    output = { ...output, ...projectArcsJob(client, kind, job, resolved?.jobId) }
    if (!options.waitForCompletion || job.status !== -1 || !resolved)
      return { success: true, output }
    const completed = await waitForArcsJob(
      client,
      resolved.link,
      options.maxWaitSeconds ?? 60,
      signal
    )
    output = { ...output, ...projectArcsJob(client, kind, completed, resolved.jobId) }
    return completed.status === 0
      ? { success: true, output }
      : { success: false, error: 'Oracle EPM job completed with errors', output }
  } catch (error) {
    return arcsFailure(error, output)
  }
}
