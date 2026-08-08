import { GITHUB_GRAPHQL_URL, githubGraphQlHeaders, readGraphQlData } from '@/tools/github/graphql'
import { isRecord, requiredBoolean, requiredString } from '@/tools/github/response-parsers'
import type { ResolveReviewThreadParams, ResolveReviewThreadResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

const CONTEXT = 'GitHub resolve review thread response'

const RESOLVE_MUTATION = `
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread {
        id
        isResolved
      }
    }
  }
`

export const resolveReviewThreadTool: ToolConfig<
  ResolveReviewThreadParams,
  ResolveReviewThreadResponse
> = {
  id: 'github_resolve_review_thread',
  name: 'GitHub Resolve Review Thread',
  description: 'Mark a pull request review thread as resolved.',
  version: '1.0.0',

  params: {
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Review thread node ID',
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
    body: (params) => ({
      query: RESOLVE_MUTATION,
      variables: { threadId: params.threadId },
    }),
  },

  transformResponse: async (response) => {
    const data = await readGraphQlData(response, CONTEXT)

    const payload = data.resolveReviewThread
    if (!isRecord(payload)) throw new Error(`${CONTEXT}.resolveReviewThread is missing`)
    const thread = payload.thread
    if (!isRecord(thread)) throw new Error(`${CONTEXT}.thread is missing`)

    return {
      success: true,
      output: {
        id: requiredString(thread, 'id', `${CONTEXT}.thread`),
        isResolved: requiredBoolean(thread, 'isResolved', `${CONTEXT}.thread`),
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Review thread node ID' },
    isResolved: { type: 'boolean', description: 'Whether the thread is now resolved' },
  },
}
