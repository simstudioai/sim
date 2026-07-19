import type {
  GitLabListRepositoryTreeParams,
  GitLabListRepositoryTreeResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabListRepositoryTreeTool: ToolConfig<
  GitLabListRepositoryTreeParams,
  GitLabListRepositoryTreeResponse
> = {
  id: 'gitlab_list_repository_tree',
  name: 'GitLab List Repository Tree',
  description: 'List files and directories in a GitLab project repository',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitLab Personal Access Token',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Self-managed GitLab host (e.g. gitlab.example.com). Defaults to gitlab.com.',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID or path (e.g. mygroup/myproject)',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Path inside the repository to list',
    },
    ref: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branch, tag, or commit SHA to list from',
    },
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to list files recursively',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default 20, max 100)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      const queryParams = new URLSearchParams()

      if (params.path) queryParams.append('path', params.path)
      if (params.ref) queryParams.append('ref', params.ref)
      if (params.recursive) queryParams.append('recursive', 'true')
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/repository/tree${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      'PRIVATE-TOKEN': params.accessToken,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `GitLab API error: ${response.status} ${errorText}`,
        output: {},
      }
    }

    const tree = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        tree: tree ?? [],
        total: total ? Number.parseInt(total, 10) : (tree?.length ?? 0),
      },
    }
  },

  outputs: {
    tree: {
      type: 'array',
      description: 'List of repository tree entries',
    },
    total: {
      type: 'number',
      description: 'Total number of tree entries',
    },
  },
}
