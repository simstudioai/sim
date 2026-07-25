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
 * The tail is what matters: a failing job reports its error at the end.
 *
 * Reading the whole body first is safe because the tool executor already caps a
 * response at 10 MB and hands `transformResponse` a buffer, so a log larger than
 * that fails with the executor's size-limit error before reaching here — which
 * is the honest outcome, since a truncated head would read as a passing job.
 */
function logTail(
  text: string,
  maxCharacters: number
): { logs: string; totalCharacters: number; truncated: boolean } {
  return {
    logs: text.slice(-maxCharacters),
    totalCharacters: text.length,
    truncated: text.length > maxCharacters,
  }
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
    }),
    // The redirect target is third-party blob storage. Sim's tool fetch follows
    // redirects itself rather than through the fetch spec, so without this the
    // GitHub token would be replayed to that host.
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response, params) => {
    const maxCharacters = resolveMaxCharacters(params?.maxCharacters)
    return { success: true, output: logTail(await response.text(), maxCharacters) }
  },

  outputs: {
    logs: { type: 'string', description: 'Trailing portion of the job log' },
    totalCharacters: { type: 'number', description: 'Full length of the log before truncation' },
    truncated: {
      type: 'boolean',
      description: 'Whether earlier output was dropped to fit maxCharacters',
    },
  },
}
