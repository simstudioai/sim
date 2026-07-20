import {
  parseReviewComments,
  REVIEW_BODY_MAX_LENGTH,
  reviewCommentSchema,
} from '@/tools/github/review-schema'
import type {
  CreatePRReviewComment,
  CreatePRReviewParams,
  PRReviewResponse,
} from '@/tools/github/types'
import { USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i

interface GitHubReviewUser {
  login: string
  id: number
  avatar_url: string
  html_url: string
  type: string
}

interface GitHubReview {
  id: number
  user: GitHubReviewUser | null
  body: string
  state: string
  html_url: string
  pull_request_url: string
  commit_id: string | null
  submitted_at?: string
}

interface CreatePRReviewV2Response extends ToolResponse {
  output: GitHubReview
}

interface CreatePRReviewRequestBody {
  event: CreatePRReviewParams['event']
  body?: string
  commit_id?: string
  comments?: CreatePRReviewComment[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredNonEmptyString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || !value) {
    throw new Error(`GitHub review response is missing ${field}`)
  }
  return value
}

function requiredNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`GitHub review response is missing ${field}`)
  }
  return value
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string') {
    throw new Error(`GitHub review response is missing ${field}`)
  }
  return value
}

function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value) {
    throw new Error(`GitHub review response has an invalid ${field}`)
  }
  return value
}

function nullableString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  if (value === null) return null
  if (typeof value !== 'string' || !value) {
    throw new Error(`GitHub review response has an invalid ${field}`)
  }
  return value
}

function parseReviewUser(value: unknown): GitHubReviewUser | null {
  if (value === null) return null
  if (!isRecord(value)) throw new Error('GitHub review response has an invalid user')
  return {
    login: requiredNonEmptyString(value, 'login'),
    id: requiredNumber(value, 'id'),
    avatar_url: requiredNonEmptyString(value, 'avatar_url'),
    html_url: requiredNonEmptyString(value, 'html_url'),
    type: requiredNonEmptyString(value, 'type'),
  }
}

function parseGitHubReview(value: unknown): GitHubReview {
  if (!isRecord(value)) throw new Error('GitHub review response must be an object')
  const submittedAt = optionalString(value, 'submitted_at')
  return {
    id: requiredNumber(value, 'id'),
    user: parseReviewUser(value.user),
    body: requiredString(value, 'body'),
    state: requiredNonEmptyString(value, 'state'),
    html_url: requiredNonEmptyString(value, 'html_url'),
    pull_request_url: requiredNonEmptyString(value, 'pull_request_url'),
    commit_id: nullableString(value, 'commit_id'),
    ...(submittedAt ? { submitted_at: submittedAt } : {}),
  }
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const value: unknown = await response.json()
    return isRecord(value) && typeof value.message === 'string' && value.message
      ? value.message
      : fallback
  } catch {
    return fallback
  }
}

function parseReviewEvent(value: unknown): CreatePRReviewParams['event'] {
  if (value === 'APPROVE' || value === 'REQUEST_CHANGES' || value === 'COMMENT') {
    return value
  }
  throw new Error('event must be APPROVE, REQUEST_CHANGES, or COMMENT')
}

function parseCommitId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !COMMIT_SHA_PATTERN.test(value.trim())) {
    throw new Error('commit_id must be a full 40- or 64-character commit SHA')
  }
  return value.trim()
}

export const createPRReviewTool: ToolConfig<CreatePRReviewParams, PRReviewResponse> = {
  id: 'github_create_pr_review',
  name: 'GitHub Create PR Review',
  description:
    'Submit a review for a pull request. Use APPROVE, REQUEST_CHANGES, or COMMENT. A body is required for REQUEST_CHANGES and COMMENT reviews.',
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
    pullNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request number',
    },
    event: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The review action to perform: APPROVE, REQUEST_CHANGES, or COMMENT',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The body text of the review (required for REQUEST_CHANGES and COMMENT)',
    },
    commit_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The SHA of the commit that needs a review (required when posting inline comments; defaults to the most recent commit otherwise)',
    },
    comments: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional inline comments with required path, body, line, and side fields',
      items: reviewCommentSchema,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/reviews`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const comments = parseReviewComments(params.comments)
      const commitId = parseCommitId(params.commit_id)
      if (comments.length > 0 && !commitId) {
        throw new Error('commit_id is required when posting inline review comments')
      }
      const event = parseReviewEvent(params.event)
      const reviewBody = params.body?.trim()
      if ((event === 'COMMENT' || event === 'REQUEST_CHANGES') && !reviewBody) {
        throw new Error(`body is required for ${event} reviews`)
      }
      if (reviewBody && reviewBody.length > REVIEW_BODY_MAX_LENGTH) {
        throw new Error(`body must not exceed ${REVIEW_BODY_MAX_LENGTH} characters`)
      }

      const body: CreatePRReviewRequestBody = {
        event,
      }
      if (reviewBody) body.body = reviewBody
      if (commitId) body.commit_id = commitId
      if (comments.length > 0) body.comments = comments
      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      return {
        success: false,
        error: await responseErrorMessage(
          response,
          `Failed to submit PR review (HTTP ${response.status})`
        ),
        output: {
          content: '',
          metadata: { id: 0, state: '', body: '', html_url: '', commit_id: null },
        },
      }
    }

    const value: unknown = await response.json()
    const review = parseGitHubReview(value)

    const content = `Review submitted for PR #${review.pull_request_url.split('/').pop()}
State: ${review.state}
URL: ${review.html_url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: review.id,
          state: review.state,
          body: review.body,
          html_url: review.html_url,
          commit_id: review.commit_id,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable review confirmation' },
    metadata: {
      type: 'object',
      description: 'Review metadata',
      properties: {
        id: { type: 'number', description: 'Review ID' },
        state: {
          type: 'string',
          description: 'Review state (APPROVED/CHANGES_REQUESTED/COMMENTED)',
        },
        body: { type: 'string', description: 'Review body text' },
        html_url: { type: 'string', description: 'GitHub web URL for the review' },
        commit_id: { type: 'string', description: 'SHA of the reviewed commit', nullable: true },
      },
    },
  },
}

export const createPRReviewV2Tool: ToolConfig<CreatePRReviewParams, CreatePRReviewV2Response> = {
  id: 'github_create_pr_review_v2',
  name: createPRReviewTool.name,
  description: createPRReviewTool.description,
  version: '2.0.0',
  params: createPRReviewTool.params,
  request: createPRReviewTool.request,

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        error: await responseErrorMessage(
          response,
          `Failed to submit PR review (HTTP ${response.status})`
        ),
        output: {
          id: 0,
          user: null,
          body: '',
          state: '',
          html_url: '',
          pull_request_url: '',
          commit_id: null,
        },
      }
    }

    const value: unknown = await response.json()
    const review = parseGitHubReview(value)
    return {
      success: true,
      output: {
        id: review.id,
        user: review.user,
        body: review.body,
        state: review.state,
        html_url: review.html_url,
        pull_request_url: review.pull_request_url,
        commit_id: review.commit_id,
        ...(review.submitted_at ? { submitted_at: review.submitted_at } : {}),
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Review ID' },
    user: { ...USER_OUTPUT, nullable: true },
    body: { type: 'string', description: 'Review body text' },
    state: { type: 'string', description: 'Review state (APPROVED/CHANGES_REQUESTED/COMMENTED)' },
    html_url: { type: 'string', description: 'GitHub web URL for the review' },
    pull_request_url: { type: 'string', description: 'API URL of the reviewed pull request' },
    commit_id: { type: 'string', description: 'SHA of the reviewed commit', nullable: true },
    submitted_at: {
      type: 'string',
      description: 'Review submission timestamp',
      optional: true,
    },
  },
}
