import type { ToolConfig } from '@/tools/types'
import type { VercelGetProjectParams, VercelGetProjectResponse } from '@/tools/vercel/types'

export const vercelGetProjectTool: ToolConfig<VercelGetProjectParams, VercelGetProjectResponse> = {
  id: 'vercel_get_project',
  name: 'Vercel Get Project',
  description: 'Get details of a specific Vercel project',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID or name',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team slug to scope the request (alternative to teamId)',
    },
  },

  request: {
    url: (params: VercelGetProjectParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      if (params.slug) query.set('slug', params.slug.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v9/projects/${params.projectId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetProjectParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        framework: data.framework ?? null,
        rootDirectory: data.rootDirectory ?? null,
        nodeVersion: data.nodeVersion ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        link: data.link
          ? {
              type: data.link.type,
              repo: data.link.repo,
              org: data.link.org,
            }
          : null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Project ID' },
    name: { type: 'string', description: 'Project name' },
    framework: { type: 'string', description: 'Project framework', optional: true },
    rootDirectory: { type: 'string', description: 'Root directory of the project', optional: true },
    nodeVersion: { type: 'string', description: 'Node.js version', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last updated timestamp' },
    link: {
      type: 'object',
      description: 'Git repository connection',
      optional: true,
      properties: {
        type: { type: 'string', description: 'Repository type (github, gitlab, bitbucket)' },
        repo: { type: 'string', description: 'Repository name' },
        org: { type: 'string', description: 'Organization or owner' },
      },
    },
  },
}
