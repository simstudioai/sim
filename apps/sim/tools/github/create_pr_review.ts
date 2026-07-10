import type {
  CreatePRReviewComment,
  CreatePRReviewParams,
  PRReviewResponse,
} from '@/tools/github/types'
import { USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

function normalizeReviewComments(
  comments: CreatePRReviewParams['comments'] | string | undefined
): CreatePRReviewComment[] {
  if (!comments) return []
  let parsed: unknown = comments
  if (typeof comments === 'string') {
    try {
      parsed = JSON.parse(comments)
    } catch {
      throw new Error('comments must be a JSON array of inline review comments')
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error('comments must be an array of inline review comments')
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`comments[${index}] must be an object`)
    }
    const comment = item as Record<string, unknown>
    if (typeof comment.path !== 'string' || !comment.path.trim()) {
      throw new Error(`comments[${index}].path is required`)
    }
    if (typeof comment.body !== 'string' || !comment.body.trim()) {
      throw new Error(`comments[${index}].body is required`)
    }
    const normalized: CreatePRReviewComment = {
      path: comment.path.trim(),
      body: comment.body,
    }
    if (typeof comment.line === 'number') normalized.line = comment.line
    if (comment.side === 'LEFT' || comment.side === 'RIGHT') normalized.side = comment.side
    if (typeof comment.start_line === 'number') normalized.start_line = comment.start_line
    if (comment.start_side === 'LEFT' || comment.start_side === 'RIGHT') {
      normalized.start_side = comment.start_side
    }
    return normalized
  })
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
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional array of inline review comments: [{ path, body, line?, side?, start_line?, start_side? }]',
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
      const comments = normalizeReviewComments(params.comments)
      if (comments.length > 0 && !params.commit_id) {
        throw new Error('commit_id is required when posting inline review comments')
      }

      const body: Record<string, any> = {
        event: params.event,
      }
      if (params.body) body.body = params.body
      if (params.commit_id) body.commit_id = params.commit_id
      if (comments.length > 0) body.comments = comments
      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return {
        success: false,
        error: error.message || `Failed to submit PR review (HTTP ${response.status})`,
        output: {
          content: '',
          metadata: { id: 0, state: '', body: '', html_url: '', commit_id: '' },
        },
      }
    }

    const review = await response.json()

    const content = `Review submitted for PR #${review.pull_request_url?.split('/').pop() ?? ''}
State: ${review.state}
URL: ${review.html_url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: review.id,
          state: review.state,
          body: review.body ?? '',
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
        commit_id: { type: 'string', description: 'SHA of the reviewed commit' },
      },
    },
  },
}

export const createPRReviewV2Tool: ToolConfig<CreatePRReviewParams, any> = {
  id: 'github_create_pr_review_v2',
  name: createPRReviewTool.name,
  description: createPRReviewTool.description,
  version: '2.0.0',
  params: createPRReviewTool.params,
  request: createPRReviewTool.request,

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return {
        success: false,
        error: error.message || `Failed to submit PR review (HTTP ${response.status})`,
        output: {
          id: 0,
          user: null,
          body: null,
          state: '',
          html_url: '',
          pull_request_url: '',
          commit_id: '',
          submitted_at: null,
        },
      }
    }

    const review = await response.json()
    return {
      success: true,
      output: {
        id: review.id,
        user: review.user ?? null,
        body: review.body ?? null,
        state: review.state,
        html_url: review.html_url,
        pull_request_url: review.pull_request_url,
        commit_id: review.commit_id,
        submitted_at: review.submitted_at ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Review ID' },
    user: { ...USER_OUTPUT, optional: true },
    body: { type: 'string', description: 'Review body text' },
    state: { type: 'string', description: 'Review state (APPROVED/CHANGES_REQUESTED/COMMENTED)' },
    html_url: { type: 'string', description: 'GitHub web URL for the review' },
    pull_request_url: { type: 'string', description: 'API URL of the reviewed pull request' },
    commit_id: { type: 'string', description: 'SHA of the reviewed commit' },
    submitted_at: { type: 'string', description: 'Review submission timestamp' },
  },
}
