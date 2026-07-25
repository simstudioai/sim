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
 * Keeps only the last `maxCharacters` of the log while streaming it, so a
 * multi-hundred-megabyte job log costs a bounded amount of memory. The tail is
 * what matters: a failing job reports its error at the end.
 */
async function readLogTail(
  response: Response,
  maxCharacters: number
): Promise<{ logs: string; totalCharacters: number; truncated: boolean }> {
  const stream = response.body
  if (!stream) {
    const text = await response.text()
    return {
      logs: text.slice(-maxCharacters),
      totalCharacters: text.length,
      truncated: text.length > maxCharacters,
    }
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let tail = ''
  let totalCharacters = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      totalCharacters += chunk.length
      tail = (tail + chunk).slice(-maxCharacters)
    }
    const trailing = decoder.decode()
    if (trailing) {
      totalCharacters += trailing.length
      tail = (tail + trailing).slice(-maxCharacters)
    }
  } finally {
    reader.releaseLock()
  }

  return { logs: tail, totalCharacters, truncated: totalCharacters > maxCharacters }
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
    // GitHub answers with a 302 to a short-lived blob URL carrying the plain-text
    // log; fetch follows it. This is the per-job endpoint, not the run-level zip.
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/actions/jobs/${params.job_id}/logs`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response, params) => {
    const maxCharacters = resolveMaxCharacters(params?.maxCharacters)
    const tail = await readLogTail(response, maxCharacters)
    return { success: true, output: tail }
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
