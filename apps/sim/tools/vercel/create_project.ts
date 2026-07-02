import type { ToolConfig } from '@/tools/types'
import type { VercelCreateProjectParams, VercelCreateProjectResponse } from '@/tools/vercel/types'

export const vercelCreateProjectTool: ToolConfig<
  VercelCreateProjectParams,
  VercelCreateProjectResponse
> = {
  id: 'vercel_create_project',
  name: 'Vercel Create Project',
  description: 'Create a new Vercel project',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project name',
    },
    framework: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project framework (e.g. nextjs, remix, vite)',
    },
    gitRepository: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Git repository connection object with type and repo',
    },
    buildCommand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom build command',
    },
    outputDirectory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom output directory',
    },
    installCommand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom install command',
    },
    rootDirectory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subdirectory of the repository the project lives in (for monorepos)',
    },
    nodeVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Node.js version to use (e.g. 22.x, 20.x, 18.x)',
    },
    devCommand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom dev server command',
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
    url: (params: VercelCreateProjectParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      if (params.slug) query.set('slug', params.slug.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v11/projects${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelCreateProjectParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelCreateProjectParams) => {
      const body: Record<string, unknown> = { name: params.name.trim() }
      if (params.framework) body.framework = params.framework.trim()
      if (params.gitRepository) body.gitRepository = params.gitRepository
      if (params.buildCommand) body.buildCommand = params.buildCommand.trim()
      if (params.outputDirectory) body.outputDirectory = params.outputDirectory.trim()
      if (params.installCommand) body.installCommand = params.installCommand.trim()
      if (params.rootDirectory) body.rootDirectory = params.rootDirectory.trim()
      if (params.nodeVersion) body.nodeVersion = params.nodeVersion.trim()
      if (params.devCommand) body.devCommand = params.devCommand.trim()
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        framework: data.framework ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Project ID' },
    name: { type: 'string', description: 'Project name' },
    framework: { type: 'string', description: 'Project framework', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last updated timestamp' },
  },
}
