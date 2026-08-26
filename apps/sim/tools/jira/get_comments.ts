import type { JiraGetCommentsParams, JiraGetCommentsResponse } from '@/tools/jira/types'
import { COMMENT_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { extractAdfText, getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * The sort orders Jira's REST v3 spec declares for
 * `GET /rest/api/3/issue/{issueIdOrKey}/comment` — the `orderBy` parameter's
 * `enum` is exactly these three values.
 */
const COMMENT_ORDER_BY = ['created', '-created', '+created'] as const

const DEFAULT_ORDER_BY: (typeof COMMENT_ORDER_BY)[number] = '-created'

/**
 * Builds the comments URL for both call sites — `request.url` and the
 * `transformResponse` rebuild — so the two cannot drift.
 *
 * `orderBy` is `visibility: 'user-or-llm'` and was interpolated raw, so a value
 * like `-created&maxResults=5000` appended arbitrary query parameters to a
 * request carrying the caller's OAuth token. It is **rejected** rather than
 * encoded: the parameter has a closed, documented enum, and the only legal
 * value containing a reserved character is `+created`, whose `+` any encoder
 * rewrites to `%2B`. Jira documents no decoding guarantee for that spelling, so
 * encoding would risk silently changing the meaning of a legal value — while
 * rejection leaves all three legal spellings byte-identical to before.
 *
 * `startAt` and `maxResults` have no enum, so they are *encoded* instead:
 * `URLSearchParams` contains a hostile value inside its own parameter without
 * rejecting any value Jira might accept.
 */
function buildCommentsUrl(cloudId: string, params: JiraGetCommentsParams): string {
  const rawOrderBy = params.orderBy?.trim()
  const orderBy = rawOrderBy ? rawOrderBy : DEFAULT_ORDER_BY

  if (!(COMMENT_ORDER_BY as readonly string[]).includes(orderBy)) {
    throw new Error(`orderBy must be one of ${COMMENT_ORDER_BY.join(', ')}`)
  }

  const query = new URLSearchParams({
    startAt: String(params.startAt ?? 0),
    maxResults: String(params.maxResults ?? 50),
  })

  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${safeUrlPathSegment(params.issueKey ?? '', 'issueKey')}/comment?${query.toString()}&orderBy=${orderBy}`
}

/**
 * Transforms a raw Jira comment object into typed output.
 */
function transformComment(comment: any) {
  return {
    id: comment.id ?? '',
    body: extractAdfText(comment.body) ?? '',
    author: transformUser(comment.author) ?? { accountId: '', displayName: '' },
    authorName: comment.author?.displayName ?? comment.author?.accountId ?? 'Unknown',
    updateAuthor: transformUser(comment.updateAuthor),
    created: comment.created ?? '',
    updated: comment.updated ?? '',
    visibility: comment.visibility
      ? { type: comment.visibility.type ?? '', value: comment.visibility.value ?? '' }
      : null,
  }
}

export const jiraGetCommentsTool: ToolConfig<JiraGetCommentsParams, JiraGetCommentsResponse> = {
  id: 'jira_get_comments',
  name: 'Jira Get Comments',
  description: 'Get all comments from a Jira issue',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    issueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira issue key to get comments from (e.g., PROJ-123)',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first comment to return (default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of comments to return (default: 50)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order for comments. Must be exactly "created", "-created" (newest first), or "+created"; any other value is rejected.',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: JiraGetCommentsParams) => {
      if (params.cloudId) {
        return buildCommentsUrl(params.cloudId, params)
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetCommentsParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraGetCommentsParams) => {
    const fetchComments = async (cloudId: string) => {
      const commentsUrl = buildCommentsUrl(cloudId, params!)
      const commentsResponse = await fetch(commentsUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!commentsResponse.ok) {
        let message = `Failed to get comments from Jira issue (${commentsResponse.status})`
        try {
          const err = await commentsResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return commentsResponse.json()
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchComments(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get comments from Jira issue (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey ?? 'unknown',
        total: data.total ?? 0,
        startAt: data.startAt ?? 0,
        maxResults: data.maxResults ?? 0,
        comments: (data.comments ?? []).map(transformComment),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    issueKey: { type: 'string', description: 'Issue key' },
    total: { type: 'number', description: 'Total number of comments' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    comments: {
      type: 'array',
      description: 'Array of comments',
      items: {
        type: 'object',
        properties: COMMENT_ITEM_PROPERTIES,
      },
    },
  },
}
