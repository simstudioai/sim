import type { GreptileSearchParams, GreptileSearchResponse } from '@/tools/greptile/types'
import { parseRepositories } from '@/tools/greptile/utils'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<GreptileSearchParams, GreptileSearchResponse> = {
  id: 'greptile_search',
  name: 'Greptile Search',
  description:
    'Search repositories in natural language and get relevant code references without generating an answer. Useful for finding specific code locations.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Natural language search query to find relevant code. Example: "authentication middleware" or "database connection handling"',
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
        'Session ID for conversation continuity. Use the same sessionId across multiple searches to maintain context. Example: "session-abc123"',
    },
    genius: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable genius mode for more thorough search (slower but more accurate)',
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
    url: 'https://api.greptile.com/v2/search',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-Github-Token': params.githubToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        query: params.query,
        repositories: parseRepositories(params.repositories),
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
        sources: (data.sources || data || []).map((source: Record<string, unknown>) => ({
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
    sources: {
      type: 'array',
      description: 'Relevant code references matching the search query',
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
