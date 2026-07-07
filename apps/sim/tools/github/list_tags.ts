import type { ListTagsParams, TagsListResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const listTagsTool: ToolConfig<ListTagsParams, TagsListResponse> = {
  id: 'github_list_tags',
  name: 'GitHub List Tags',
  description:
    'List tags for a GitHub repository. Returns tag names with their commit SHA and download URLs.',
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
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 100)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number of the results to fetch',
      default: 1,
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
      const url = new URL(`https://api.github.com/repos/${params.owner}/${params.repo}/tags`)
      if (params.per_page) {
        url.searchParams.append('per_page', Number(params.per_page).toString())
      }
      if (params.page) {
        url.searchParams.append('page', Number(params.page).toString())
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return {
        success: false,
        error: error.message || `Failed to list tags (HTTP ${response.status})`,
        output: { content: '', metadata: { total_count: 0, tags: [] } },
      }
    }

    const tags = await response.json()

    const tagsList = tags
      .map(
        (tag: any, index: number) => `${index + 1}. ${tag.name} (${tag.commit?.sha ?? 'unknown'})`
      )
      .join('\n')

    const content = `Total tags: ${tags.length}

${tagsList}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          total_count: tags.length,
          tags: tags.map((tag: any) => ({
            name: tag.name,
            commit_sha: tag.commit?.sha ?? '',
            zipball_url: tag.zipball_url,
            tarball_url: tag.tarball_url,
          })),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable list of tags' },
    metadata: {
      type: 'object',
      description: 'Tags metadata',
      properties: {
        total_count: { type: 'number', description: 'Total number of tags returned' },
        tags: {
          type: 'array',
          description: 'Array of tag objects',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Tag name' },
              commit_sha: { type: 'string', description: 'Commit SHA the tag points to' },
              zipball_url: { type: 'string', description: 'Zipball download URL' },
              tarball_url: { type: 'string', description: 'Tarball download URL' },
            },
          },
        },
      },
    },
  },
}

export const listTagsV2Tool: ToolConfig<ListTagsParams, any> = {
  id: 'github_list_tags_v2',
  name: listTagsTool.name,
  description: listTagsTool.description,
  version: '2.0.0',
  params: listTagsTool.params,
  request: listTagsTool.request,

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return {
        success: false,
        error: error.message || `Failed to list tags (HTTP ${response.status})`,
        output: { items: [], count: 0 },
      }
    }

    const tags = await response.json()
    return {
      success: true,
      output: {
        items: tags,
        count: tags.length,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of tag objects',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tag name' },
          zipball_url: { type: 'string', description: 'Zipball download URL' },
          tarball_url: { type: 'string', description: 'Tarball download URL' },
          node_id: { type: 'string', description: 'Node ID' },
          commit: {
            type: 'object',
            description: 'Commit the tag points to',
            properties: {
              sha: { type: 'string', description: 'Commit SHA' },
              url: { type: 'string', description: 'Commit API URL' },
            },
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of tags returned' },
  },
}
