import type { BranchListResponse, ListBranchesParams } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const listBranchesTool: ToolConfig<ListBranchesParams, BranchListResponse> = {
  id: 'github_list_branches',
  name: 'GitHub List Branches',
  description:
    'List all branches in a GitHub repository. Optionally filter by protected status and control pagination.',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner (user or organization)',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    protected: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter branches by protection status',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 100, default 30)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (default 1)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.github.com/repos/${params.owner}/${params.repo}/branches`
      const queryParams = new URLSearchParams()

      if (params.protected !== undefined) {
        queryParams.append('protected', params.protected.toString())
      }
      if (params.per_page) {
        queryParams.append('per_page', Number(params.per_page).toString())
      }
      if (params.page) {
        queryParams.append('page', Number(params.page).toString())
      }

      const query = queryParams.toString()
      return query ? `${baseUrl}?${query}` : baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const branches = await response.json()

    const branchList = branches
      .map(
        (branch: any) =>
          `- ${branch.name} (SHA: ${branch.commit.sha.substring(0, 7)}${branch.protected ? ', Protected' : ''})`
      )
      .join('\n')

    const content = `Found ${branches.length} branch${branches.length !== 1 ? 'es' : ''}:
${branchList}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          branches: branches.map((branch: any) => ({
            name: branch.name,
            commit: {
              sha: branch.commit.sha,
              url: branch.commit.url,
            },
            protected: branch.protected,
          })),
          total_count: branches.length,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable list of branches' },
    metadata: {
      type: 'object',
      description: 'Branch list metadata',
      properties: {
        branches: {
          type: 'array',
          description: 'Array of branch objects',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Branch name' },
              commit: {
                type: 'object',
                description: 'Commit information',
                properties: {
                  sha: { type: 'string', description: 'Commit SHA' },
                  url: { type: 'string', description: 'Commit API URL' },
                },
              },
              protected: { type: 'boolean', description: 'Whether branch is protected' },
            },
          },
        },
        total_count: { type: 'number', description: 'Total number of branches' },
      },
    },
  },
}
