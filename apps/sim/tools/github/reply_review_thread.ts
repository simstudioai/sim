import { GITHUB_GRAPHQL_URL, githubGraphQlHeaders, readGraphQlData } from '@/tools/github/graphql'
import { isRecord, requiredString } from '@/tools/github/response-parsers'
import type { ReplyReviewThreadParams, ReplyReviewThreadResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

const CONTEXT = 'GitHub review thread reply response'

/**
 * Keying the reply off the thread's node ID means a caller never needs a comment
 * database ID, and cannot address a comment outside the thread it read.
 */
const REPLY_MUTATION = `
  mutation($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
      comment {
        id
        url
        createdAt
      }
    }
  }
`

export const replyReviewThreadTool: ToolConfig<ReplyReviewThreadParams, ReplyReviewThreadResponse> =
  {
    id: 'github_reply_review_thread',
    name: 'GitHub Reply To Review Thread',
    description: 'Post a reply comment on a pull request review thread.',
    version: '1.0.0',

    params: {
      threadId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Review thread node ID',
      },
      body: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Reply body',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'GitHub API token with pull request write access',
      },
    },

    request: {
      url: GITHUB_GRAPHQL_URL,
      method: 'POST',
      headers: (params) => githubGraphQlHeaders(params.apiKey),
      body: (params) => {
        const body = params.body?.trim()
        if (!body) throw new Error('body must not be empty')
        return {
          query: REPLY_MUTATION,
          variables: { threadId: params.threadId, body },
        }
      },
    },

    transformResponse: async (response) => {
      const data = await readGraphQlData(response, CONTEXT)

      const payload = data.addPullRequestReviewThreadReply
      if (!isRecord(payload))
        throw new Error(`${CONTEXT}.addPullRequestReviewThreadReply is missing`)
      const comment = payload.comment
      if (!isRecord(comment)) throw new Error(`${CONTEXT}.comment is missing`)

      return {
        success: true,
        output: {
          id: requiredString(comment, 'id', `${CONTEXT}.comment`),
          url: requiredString(comment, 'url', `${CONTEXT}.comment`),
          createdAt: requiredString(comment, 'createdAt', `${CONTEXT}.comment`),
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Node ID of the created reply comment' },
      url: { type: 'string', description: 'GitHub web URL of the reply' },
      createdAt: { type: 'string', description: 'Creation timestamp' },
    },
  }
