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

/** Byte offsets from a `Content-Range: bytes <start>-<end>/<total>` header. */
interface ContentRange {
  start: number
  total: number | null
}

/**
 * Parses the served byte window.
 *
 * `null` for an unsatisfied-range form, an unparsable value, or an absent header.
 * The `start` matters as much as the total: a suffix range asking for more bytes
 * than the log contains is satisfied with the *whole* representation, still as a
 * 206, and only `start === 0` distinguishes that from a window that genuinely cut
 * into the middle of the log.
 */
function parseContentRange(header: string | null): ContentRange | null {
  const match = header?.match(/^bytes\s+(\d+)-\d+\/(\d+|\*)$/)
  if (!match) return null
  const start = Number(match[1])
  if (!Number.isSafeInteger(start) || start < 0) return null
  const total = match[2] === '*' ? null : Number(match[2])
  return {
    start,
    total: total !== null && Number.isSafeInteger(total) && total >= 0 ? total : null,
  }
}

/**
 * The tail is what matters: a failing job reports its error at the end.
 *
 * A window that starts partway into the log is trimmed at its first line break,
 * because the byte boundary almost always lands mid-line and can split a
 * multi-byte character. A window starting at zero is the whole log — the storage
 * host satisfied a suffix range larger than the content — so it is treated
 * exactly like an unranged body, which is the common case for a job that failed
 * fast and logged little.
 */
function logTail(
  text: string,
  maxCharacters: number,
  range: ContentRange | null
): { logs: string; truncated: boolean; totalBytes: number | null } {
  if (!range || range.start === 0) {
    return {
      logs: text.slice(-maxCharacters),
      truncated: text.length > maxCharacters,
      totalBytes: range?.total ?? Buffer.byteLength(text),
    }
  }
  const firstBreak = text.indexOf('\n')
  const trimmed = firstBreak === -1 ? text : text.slice(firstBreak + 1)
  return { logs: trimmed.slice(-maxCharacters), truncated: true, totalBytes: range.total }
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

  /**
   * A suffix range against a zero-length log is unsatisfiable, so such a job
   * surfaces as a 416 tool error rather than as empty `logs`. Not special-cased
   * here because the executor rejects a non-2xx before `transformResponse` runs,
   * and an Actions job log is never truly empty — the runner writes its own
   * setup lines before any step does.
   */
  transformResponse: async (response, params) => {
    const maxCharacters = resolveMaxCharacters(params?.maxCharacters)
    const range =
      response.status === 206 ? parseContentRange(response.headers.get('content-range')) : null
    return {
      success: true,
      output: logTail(await response.text(), maxCharacters, range),
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
