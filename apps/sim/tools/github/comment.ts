import { isRecordLike } from '@sim/utils/object'
import { formatGitHubErrorMessage } from '@/tools/github/response-parsers'
import type { CreateCommentParams, CreateCommentResponse } from '@/tools/github/types'
import { COMMENT_OUTPUT_PROPERTIES, USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

const GITHUB_API_BASE = 'https://api.github.com'

/** Body GitHub accepts on `POST /pulls/{n}/reviews`. */
interface ReviewCommentBody {
  body: string
  event: 'COMMENT'
}

/** Body GitHub accepts on `POST /pulls/{n}/comments`. */
interface FileCommentBody {
  body: string
  commit_id: string | undefined
  path: string | undefined
  line: number | undefined
  side: string
}

/** The subset of a GitHub comment payload this tool reports. */
interface GitHubCommentPayload {
  id?: number
  body?: string
  html_url?: string
  user?: unknown
  path?: string
  line?: number
  position?: number
  side?: string
  commit_id?: string
  created_at?: string
  updated_at?: string
}

function githubHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `Bearer ${apiKey}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function pullRequestUrl(params: CreateCommentParams): string {
  return `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`
}

/**
 * GitHub requires `commit_id` on a pull request review comment. When the caller did
 * not supply one, the pull request is fetched first so its head SHA can be used —
 * mirroring how Jira resolves a missing `cloudId` from `domain`.
 *
 * The lookup is gated on `path` because only a request headed for the `/comments`
 * endpoint needs a commit SHA. `path` is optional on the block, so a file comment
 * left without one still falls through to `/pulls/{n}/reviews`, where GitHub creates
 * a pending review and `commit_id` is optional.
 */
function needsCommitLookup(params: CreateCommentParams): boolean {
  return params.commentType === 'file_comment' && Boolean(params.path) && !params.commitId
}

/**
 * The block renders `line` as a short input, so a typed line number reaches the tool
 * as a string while GitHub types the field as an integer. Blank and unparseable input
 * is omitted rather than sent as `NaN` — `line` is optional, and nothing usable was
 * supplied.
 *
 * A fractional value is rejected instead of truncated. `3.9` is not the caller asking
 * for line 3, and quietly posting the review comment on a different line of the diff
 * than the one they named is the failure they would never think to look for. This
 * fails the way a missing head commit SHA does: loudly, naming what to set.
 */
function toLineNumber(value: unknown): number | undefined {
  let parsed: number
  if (typeof value === 'number') {
    parsed = value
  } else {
    if (typeof value !== 'string' || !value.trim()) return undefined
    parsed = Number(value.trim())
  }
  if (!Number.isFinite(parsed)) return undefined
  if (!Number.isInteger(parsed)) {
    throw new Error(
      `GitHub line numbers are whole numbers, but line was ${parsed}. Set line to the integer line number in the diff.`
    )
  }
  return parsed
}

function fileCommentBody(
  params: CreateCommentParams,
  commitId: string | undefined
): FileCommentBody {
  return {
    body: params.body,
    commit_id: commitId,
    path: params.path,
    line: toLineNumber(params.line),
    side: params.side || 'RIGHT',
  }
}

/**
 * The endpoint the comment itself is posted to. `path` selects the review-comment
 * endpoint; everything else lands on the reviews endpoint, where GitHub creates a
 * pending review whose `commit_id` is optional.
 */
function commentEndpointUrl(params: CreateCommentParams): string {
  return params.path ? `${pullRequestUrl(params)}/comments` : `${pullRequestUrl(params)}/reviews`
}

function commentRequestBody(
  params: CreateCommentParams,
  commitId: string | undefined
): FileCommentBody | ReviewCommentBody {
  if (params.commentType === 'file_comment') return fileCommentBody(params, commitId)
  return { body: params.body, event: 'COMMENT' }
}

function readHeadSha(pullRequest: unknown): string | undefined {
  if (!isRecordLike(pullRequest) || !isRecordLike(pullRequest.head)) return undefined
  const sha = pullRequest.head.sha
  return typeof sha === 'string' && sha ? sha : undefined
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

function readCommentPayload(value: unknown): GitHubCommentPayload {
  if (!isRecordLike(value)) return {}
  return {
    id: readNumber(value, 'id'),
    body: readString(value, 'body'),
    html_url: readString(value, 'html_url'),
    user: value.user,
    path: readString(value, 'path'),
    line: readNumber(value, 'line'),
    position: readNumber(value, 'position'),
    side: readString(value, 'side'),
    commit_id: readString(value, 'commit_id'),
    created_at: readString(value, 'created_at'),
    updated_at: readString(value, 'updated_at'),
  }
}

/**
 * Projects a failed GitHub response the way the tool transport does: the thrown error
 * carries `status`, `statusText`, and the parsed body on `data`, so callers that branch
 * on a status (a 404 treated as a clean no-match, for one) keep working off this path.
 */
async function assertGitHubResponseOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return

  const text = await response.text().catch(() => '')
  let data: unknown = text
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }

  const error = new Error(formatGitHubErrorMessage(data) ?? `${fallback} (HTTP ${response.status})`)
  Object.assign(error, { status: response.status, statusText: response.statusText, data })
  throw error
}

/**
 * Creates the comment, resolving the pull request head SHA first when a file comment
 * needs one. Both requests run on the DNS-validated, IP-pinned GitHub transport and
 * carry the execution's abort signal, so cancelling a workflow cancels the POST.
 */
async function createComment(
  params: CreateCommentParams,
  signal?: AbortSignal
): Promise<GitHubCommentPayload> {
  const { secureGitHubRequest } = await import('@/tools/github/utils.server')
  const headers = githubHeaders(params.apiKey)

  let commitId = params.commitId
  if (needsCommitLookup(params)) {
    const pullRequestResponse = await secureGitHubRequest(pullRequestUrl(params), {
      headers,
      signal,
    })
    await assertGitHubResponseOk(
      pullRequestResponse,
      `Failed to load pull request ${params.owner}/${params.repo}#${params.pullNumber}`
    )
    commitId = readHeadSha(await pullRequestResponse.json())
    if (!commitId) {
      throw new Error(
        `GitHub returned no head commit SHA for pull request ${params.owner}/${params.repo}#${params.pullNumber}. Set commitId to comment on a specific commit.`
      )
    }
  }

  const response = await secureGitHubRequest(commentEndpointUrl(params), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(commentRequestBody(params, commitId)),
    signal,
  })
  await assertGitHubResponseOk(response, 'Failed to create comment')

  return readCommentPayload(await response.json())
}

const DIRECT_EXECUTION_ONLY_ERROR = 'GitHub comments require the two-phase direct execution path'

export const commentTool: ToolConfig<CreateCommentParams, CreateCommentResponse> = {
  id: 'github_comment',
  name: 'GitHub PR Commenter',
  description: 'Create comments on GitHub PRs',
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
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment content',
    },
    pullNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request number',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'File path for review comment',
    },
    commentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type of comment (pr_comment or file_comment)',
    },
    line: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Line number for review comment',
    },
    side: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Side of the diff (LEFT or RIGHT)',
      default: 'RIGHT',
    },
    commitId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The SHA of the commit to comment on. Defaults to the pull request head commit.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  directExecution: async (params, signal) => {
    const data = await createComment(params, signal)

    return {
      success: true,
      output: {
        content: `Comment created: "${data.body}"`,
        metadata: {
          id: data.id,
          html_url: data.html_url,
          created_at: data.created_at,
          updated_at: data.updated_at,
          path: data.path,
          line: data.line || data.position,
          side: data.side,
          commit_id: data.commit_id,
        },
      },
    }
  },

  request: {
    url: (params) => {
      if (needsCommitLookup(params)) {
        return pullRequestUrl(params)
      }
      return commentEndpointUrl(params)
    },
    method: (params) => (needsCommitLookup(params) ? 'GET' : 'POST'),
    headers: (params) => githubHeaders(params.apiKey),
    body: (params) => {
      if (needsCommitLookup(params)) {
        return undefined
      }
      return commentRequestBody(params, params.commitId)
    },
  },

  transformResponse: async () => {
    throw new Error(DIRECT_EXECUTION_ONLY_ERROR)
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable comment confirmation' },
    metadata: {
      type: 'object',
      description: 'Comment metadata',
    },
  },
}

export const commentV2Tool: ToolConfig<CreateCommentParams> = {
  id: 'github_comment_v2',
  name: commentTool.name,
  description: commentTool.description,
  version: '2.0.0',
  params: commentTool.params,
  request: commentTool.request,
  directExecution: async (params, signal) => {
    const data = await createComment(params, signal)
    return {
      success: true,
      output: {
        id: data.id,
        body: data.body,
        html_url: data.html_url,
        user: data.user,
        path: data.path ?? null,
        line: data.line ?? data.position ?? null,
        side: data.side ?? null,
        commit_id: data.commit_id ?? null,
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
    }
  },
  transformResponse: async () => {
    throw new Error(DIRECT_EXECUTION_ONLY_ERROR)
  },
  outputs: {
    ...COMMENT_OUTPUT_PROPERTIES,
    user: USER_OUTPUT,
    path: { type: 'string', description: 'File path (if file comment)', optional: true },
    line: { type: 'number', description: 'Line number', optional: true },
    side: { type: 'string', description: 'Diff side', optional: true },
    commit_id: { type: 'string', description: 'Commit ID', optional: true },
  },
}
