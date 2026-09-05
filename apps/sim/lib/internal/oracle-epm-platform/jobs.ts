import type { OracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { pollOracleEpmJob } from '@/lib/internal/oracle-epm/jobs'
import type {
  OracleEpmReturnedLinkPolicy,
  OracleEpmValidatedLink,
} from '@/lib/internal/oracle-epm/types'
import {
  jsonBody,
  linksSchema,
  OracleEpmPlatformResponseError,
  parseResponse,
  readStatus,
  statusOutput,
  tasksSchema,
} from '@/lib/internal/oracle-epm-platform/responses'
import {
  jobEndpoints,
  jobLinkPolicies,
  repositoryUploadStatusEndpoint,
  repositoryUploadStatusPolicy,
} from '@/lib/internal/oracle-epm-platform/routes'
import {
  LEGACY_UPLOAD_JOB_PREFIX,
  legacyUploadJobFileName,
} from '@/lib/internal/oracle-epm-platform/schemas'
import type { OracleEpmAdminJobKind, OracleEpmJob } from '@/tools/oracle_epm_platform/types'

export interface OracleEpmJobLink {
  id: string
  handle: OracleEpmValidatedLink
}

/** Validate the exact link first; extract only its serializable numeric ID afterward. */
export function readJobLink(
  client: OracleEpmClient,
  value: unknown,
  policy: OracleEpmReturnedLinkPolicy,
  relation = 'Job Status'
): OracleEpmJobLink {
  const candidates = parseResponse(linksSchema, value).links.filter((link) => link.rel === relation)
  if (candidates.length !== 1) throw new OracleEpmPlatformResponseError()
  const link = candidates[0]
  const handle = client.validateReturnedLink(policy, {
    rel: link.rel,
    href: link.href,
    method: link.action,
  })
  // The fixed base only permits parsing a relative link that the credential-bound client validated.
  const path = new URL(link.href, 'https://epm.invalid').pathname
  const id = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
  if (!/^[0-9]{1,64}$/.test(id)) throw new OracleEpmPlatformResponseError()
  return { id, handle }
}

export function projectJob(
  client: OracleEpmClient,
  value: unknown,
  kind: OracleEpmAdminJobKind,
  knownId?: string
): OracleEpmJob {
  const status = readStatus(value)
  const id =
    knownId ?? (status === -1 ? readJobLink(client, value, jobLinkPolicies[kind]).id : undefined)
  const tasks = kind === 'migration' ? parseResponse(tasksSchema, value).items : undefined
  return {
    ...statusOutput(status),
    completed: status !== -1,
    ...(id === undefined ? {} : { jobId: id, jobKind: kind }),
    ...(tasks == null ? {} : { tasks }),
  }
}

/**
 * The legacy repository upload uses a filename-addressed extraction status, unlike v1 uploads.
 * Preserve immediate starter semantics with a tagged Sim reference, never a serialized URL/handle.
 */
export function projectRepositoryUploadJob(
  client: OracleEpmClient,
  value: unknown,
  fileName: string
): OracleEpmJob {
  const status = readStatus(value)
  if (status !== -1) return { ...statusOutput(status), completed: true }
  const links = parseResponse(linksSchema, value).links.filter((link) => link.rel === 'Job Status')
  if (links.length !== 1) throw new OracleEpmPlatformResponseError()
  const link = links[0]
  client.validateReturnedLink(repositoryUploadStatusPolicy, {
    rel: link.rel,
    href: link.href,
    method: link.action,
  })
  const returnedName = decodeURIComponent(new URL(link.href).pathname.split('/').at(-3) ?? '')
  if (returnedName !== fileName) throw new OracleEpmPlatformResponseError()
  const jobId = LEGACY_UPLOAD_JOB_PREFIX + encodeURIComponent(returnedName)
  if (legacyUploadJobFileName(jobId) === undefined) throw new OracleEpmPlatformResponseError()
  return { ...statusOutput(status), completed: false, jobId, jobKind: 'snapshot_upload' }
}

/** Bounded waiting is opt-in. A normal status tool invocation makes just one status read. */
export async function getAdminJobStatus(
  client: OracleEpmClient,
  input: { jobId: string; jobKind: OracleEpmAdminJobKind; waitForCompletion?: boolean },
  signal?: AbortSignal
): Promise<OracleEpmJob> {
  const repositoryFileName =
    input.jobKind === 'snapshot_upload' ? legacyUploadJobFileName(input.jobId) : undefined
  const read = async (readSignal?: AbortSignal) => {
    const value = jsonBody(
      await client.request(
        repositoryFileName === undefined
          ? jobEndpoints[input.jobKind]
          : repositoryUploadStatusEndpoint,
        {
          pathParams:
            repositoryFileName === undefined
              ? { jobId: input.jobId }
              : { fileName: repositoryFileName },
          signal: readSignal,
        }
      )
    )
    readSignal?.throwIfAborted()
    return projectJob(client, value, input.jobKind, input.jobId)
  }
  if (!input.waitForCompletion) return read(signal)
  const result = await pollOracleEpmJob<OracleEpmJob, OracleEpmJob, OracleEpmJob>({
    read,
    classify: (snapshot) =>
      snapshot.status === -1
        ? { state: 'pending' }
        : snapshot.status === 0
          ? { state: 'success', result: snapshot }
          : { state: 'failure', error: snapshot },
    signal,
    maxWaitMs: 120_000,
    cleanupReserveMs: 5_000,
    maxAttempts: 40,
    initialDelayMs: 1000,
    maxDelayMs: 5000,
  })
  return result.state === 'success' ? result.result : result.error
}
