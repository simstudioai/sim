import type { JobLogsParams, JobLogsResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_MAX_CHARACTERS = 20_000
const MAX_CHARACTERS_LIMIT = 200_000

function resolveMaxCharacters(value: number | undefined): number {
  const requested = value ?? DEFAULT_MAX_CHARACTERS
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > MAX_CHARACTERS_LIMIT) {
    throw new Error(`maxCharacters must be an integer between 1 and ${MAX_CHARACTERS_LIMIT}`)
  }
  return requested
}

/**
 * Every path segment is escaped or checked before it reaches the URL.
 *
 * Raw interpolation is the prevailing shape among the GitHub tools here, but it
 * costs more in this one: the response body is returned verbatim as `logs`
 * instead of being parsed into a fixed shape, so a coordinate carrying URL syntax
 * would turn a bearer-authenticated request into a general read of whatever
 * endpoint it reached. Siblings that parse a typed response fail closed instead.
 */
function jobLogsPath(owner: string, repo: string, jobId: number): string {
  if (!Number.isSafeInteger(jobId) || jobId < 1) {
    throw new Error('job_id must be a positive integer')
  }
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/jobs/${jobId}/logs`
}

/**
 * Total size from a `Content-Range: bytes <start>-<end>/<total>` header.
 *
 * `null` for an unsatisfied-range form, an unknown total, an unparsable value, or
 * an absent header — all of which mean the full size is simply unknown here.
 */
function parseContentRangeTotal(header: string | null): number | null {
  const total = header?.match(/^bytes\s+\d+-\d+\/(\d+)$/)?.[1]
  if (!total) return null
  const parsed = Number(total)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

/**
 * The tail is what matters: a failing job reports its error at the end.
 *
 * A ranged response already *is* the tail, so it is only trimmed at the first
 * line break — the byte window almost always cuts mid-line, and it can also split
 * a multi-byte character into a replacement char. A full response is sliced
 * locally instead, which is the path taken whenever the storage host ignores the
 * range and answers 200.
 */
function logTail(
  text: string,
  maxCharacters: number,
  partial: boolean,
  totalBytes: number | null
): { logs: string; truncated: boolean; totalBytes: number | null } {
  if (!partial) {
    return {
      logs: text.slice(-maxCharacters),
      truncated: text.length > maxCharacters,
      totalBytes: totalBytes ?? Buffer.byteLength(text),
    }
  }
  const firstBreak = text.indexOf('\n')
  const trimmed = firstBreak === -1 ? text : text.slice(firstBreak + 1)
  return { logs: trimmed.slice(-maxCharacters), truncated: true, totalBytes }
}

export const jobLogsTool: ToolConfig<JobLogsParams, JobLogsResponse> = {
  id: 'github_job_logs',
  name: 'GitHub Job Logs',
  description:
    "Read the tail of a GitHub Actions job log. Takes the job id, which is a check run's databaseId for an Actions check.",
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    job_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: "Actions job id (a check run's databaseId for an Actions check run)",
    },
    maxCharacters: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: `Characters of log tail to return (1-${MAX_CHARACTERS_LIMIT})`,
      default: DEFAULT_MAX_CHARACTERS,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token with Actions read access',
    },
  },

  request: {
    // The per-job endpoint, not the run-level zip archive. GitHub answers with a
    // 302 to a short-lived blob URL that carries its own signature.
    url: (params) =>
      `https://api.github.com/repos/${jobLogsPath(params.owner, params.repo, params.job_id)}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
      // Ask the storage host for only the tail we intend to keep. A CI job with a
      // verbose build routinely exceeds the executor's 10 MB response cap, and that
      // cap throws rather than truncating — so without this a large log yielded no
      // diagnostic at all, on exactly the runs that most need one. A suffix range is
      // a request, not a guarantee: a host that ignores it answers 200 with the full
      // body and the local slice below still applies.
      Range: `bytes=-${resolveMaxCharacters(params.maxCharacters)}`,
    }),
    // The redirect target is third-party blob storage. Sim's tool fetch follows
    // redirects itself rather than through the fetch spec, so without this the
    // GitHub token would be replayed to that host.
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response, params) => {
    const maxCharacters = resolveMaxCharacters(params?.maxCharacters)
    const partial = response.status === 206
    const totalBytes = parseContentRangeTotal(response.headers.get('content-range'))
    return {
      success: true,
      output: logTail(await response.text(), maxCharacters, partial, totalBytes),
    }
  },

  outputs: {
    logs: { type: 'string', description: 'Trailing portion of the job log' },
    truncated: {
      type: 'boolean',
      description: 'Whether earlier output was dropped to fit maxCharacters',
    },
    totalBytes: {
      type: 'number',
      description: 'Full size of the log in bytes, null when the server did not report it',
      nullable: true,
    },
  },
}
