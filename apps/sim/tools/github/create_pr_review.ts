import type { CreatePRReviewParams, PRReviewResponse } from '@/tools/github/types'
import { USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

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
      description: 'The SHA of the commit that needs a review (defaults to the most recent commit)',
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
      const body: Record<string, any> = {
        event: params.event,
      }
      if (params.body) body.body = params.body
      if (params.commit_id) body.commit_id = params.commit_id
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
