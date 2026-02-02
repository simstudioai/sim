import type { GreptileQueryParams, GreptileQueryResponse } from '@/tools/greptile/types'
import { parseRepositories } from '@/tools/greptile/utils'
import type { ToolConfig } from '@/tools/types'

export const queryTool: ToolConfig<GreptileQueryParams, GreptileQueryResponse> = {
  id: 'greptile_query',
  name: 'Greptile Query',
  description:
    'Query repositories in natural language and get answers with relevant code references. Greptile uses AI to understand your codebase and answer questions.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Natural language question about the codebase. Example: "How does authentication work?" or "Where is the payment processing logic?"',
    },
    repositories: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of repositories. Format: "github:branch:owner/repo" or just "owner/repo" (defaults to github:main). Example: "facebook/react" or "github:main:facebook/react,github:main:facebook/relay"',
    },
    sessionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Session ID for conversation continuity. Use the same sessionId across multiple queries to maintain context. Example: "session-abc123"',
    },
    genius: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable genius mode for more thorough analysis (slower but more accurate)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Greptile API key',
    },
    githubToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token with repo read access',
    },
  },

  request: {
    url: 'https://api.greptile.com/v2/query',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-Github-Token': params.githubToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        messages: [
          {
            role: 'user',
            content: params.query,
          },
        ],
        repositories: parseRepositories(params.repositories),
        stream: false,
      }

      if (params.sessionId) {
        body.sessionId = params.sessionId
      }

      if (params.genius != null) {
        body.genius = params.genius
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        message: data.message || '',
        sources: (data.sources || []).map((source: Record<string, unknown>) => ({
          repository: source.repository || '',
          remote: source.remote || '',
          branch: source.branch || '',
          filepath: source.filepath || '',
          linestart: source.linestart,
          lineend: source.lineend,
          summary: source.summary,
          distance: source.distance,
        })),
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'AI-generated answer to the query',
    },
    sources: {
      type: 'array',
      description: 'Relevant code references that support the answer',
      items: {
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository name (owner/repo)' },
          remote: { type: 'string', description: 'Git remote (github/gitlab)' },
          branch: { type: 'string', description: 'Branch name' },
          filepath: { type: 'string', description: 'Path to the file' },
          linestart: { type: 'number', description: 'Starting line number' },
          lineend: { type: 'number', description: 'Ending line number' },
          summary: { type: 'string', description: 'Summary of the code section' },
          distance: { type: 'number', description: 'Similarity score (lower = more relevant)' },
        },
      },
    },
  },
}
