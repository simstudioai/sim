import { isRecordLike } from '@sim/utils/object'
import { readGitHubErrorMessage } from '@/tools/github/response-parsers'
import type { CreateCommentParams, CreateCommentResponse } from '@/tools/github/types'
import { COMMENT_OUTPUT_PROPERTIES, USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

const GITHUB_API_BASE = 'https://api.github.com'

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
 * as a string while GitHub types the field as an integer. Anything that is not a
 * finite number is omitted rather than sent as `NaN`.
 */
function toLineNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
}

function fileCommentBody(params: CreateCommentParams, commitId: string): Record<string, any> {
  return {
    body: params.body,
    commit_id: commitId,
    path: params.path,
    line: toLineNumber(params.line),
    side: params.side || 'RIGHT',
  }
}

function readHeadSha(pullRequest: unknown): string | undefined {
  if (!isRecordLike(pullRequest) || !isRecordLike(pullRequest.head)) return undefined
  const sha = pullRequest.head.sha
  return typeof sha === 'string' && sha ? sha : undefined
}

/**
 * Returns the raw GitHub comment payload. For a file comment created without an
 * explicit `commitId`, `response` holds the pull request lookup instead: its head
 * SHA is read and the comment is posted in a follow-up request.
 */
async function readCommentPayload(
  response: Response,
  params?: CreateCommentParams
): Promise<Record<string, any>> {
  if (!params || !needsCommitLookup(params)) return response.json()

  const commitId = readHeadSha(await response.json())
  if (!commitId) {
    throw new Error(
      `GitHub returned no head commit SHA for pull request ${params.owner}/${params.repo}#${params.pullNumber}. Set commitId to comment on a specific commit.`
    )
  }

  const commentResponse = await fetch(`${pullRequestUrl(params)}/comments`, {
    method: 'POST',
    headers: { ...githubHeaders(params.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(fileCommentBody(params, commitId)),
  })

  if (!commentResponse.ok) {
    throw new Error(
      (await readGitHubErrorMessage(commentResponse)) ??
        `Failed to create file comment (HTTP ${commentResponse.status})`
    )
  }

  return commentResponse.json()
}

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

  request: {
    url: (params) => {
      if (needsCommitLookup(params)) {
        return pullRequestUrl(params)
      }
      if (params.path) {
        return `${pullRequestUrl(params)}/comments`
      }
      return `${pullRequestUrl(params)}/reviews`
    },
    method: (params) => (needsCommitLookup(params) ? 'GET' : 'POST'),
    headers: (params) => githubHeaders(params.apiKey),
    body: (params) => {
      if (needsCommitLookup(params)) {
        return undefined
      }
      if (params.commentType === 'file_comment') {
        return fileCommentBody(params, params.commitId as string)
      }
      return {
        body: params.body,
        event: 'COMMENT',
      }
    },
  },

  transformResponse: async (response, params) => {
    const data = await readCommentPayload(response, params)

    // Create a human-readable content string
    const content = `Comment created: "${data.body}"`

    return {
      success: true,
      output: {
        content,
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
  transformResponse: async (response: Response, params?: CreateCommentParams) => {
    const data = await readCommentPayload(response, params)
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
  outputs: {
    ...COMMENT_OUTPUT_PROPERTIES,
    user: USER_OUTPUT,
    path: { type: 'string', description: 'File path (if file comment)', optional: true },
    line: { type: 'number', description: 'Line number', optional: true },
    side: { type: 'string', description: 'Diff side', optional: true },
    commit_id: { type: 'string', description: 'Commit ID', optional: true },
  },
}
