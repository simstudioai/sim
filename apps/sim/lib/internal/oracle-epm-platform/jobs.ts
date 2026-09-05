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
import { jobEndpoints, jobLinkPolicies } from '@/lib/internal/oracle-epm-platform/routes'
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

/** Bounded waiting is opt-in. A normal status tool invocation makes just one status read. */
export async function getAdminJobStatus(
  client: OracleEpmClient,
  input: { jobId: string; jobKind: OracleEpmAdminJobKind; waitForCompletion?: boolean },
  signal?: AbortSignal
): Promise<OracleEpmJob> {
  const read = async (readSignal?: AbortSignal) => {
    const value = jsonBody(
      await client.request(jobEndpoints[input.jobKind], {
        pathParams: { jobId: input.jobId },
        signal: readSignal,
      })
    )
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
