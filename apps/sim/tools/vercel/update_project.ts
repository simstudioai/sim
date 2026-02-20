import type { ToolConfig } from '@/tools/types'
import type { VercelUpdateProjectParams, VercelUpdateProjectResponse } from '@/tools/vercel/types'

export const vercelUpdateProjectTool: ToolConfig<
  VercelUpdateProjectParams,
  VercelUpdateProjectResponse
> = {
  id: 'vercel_update_project',
  name: 'Vercel Update Project',
  description: 'Update an existing Vercel project',
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
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New project name',
    },
    framework: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project framework (e.g. nextjs, remix, vite)',
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
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelUpdateProjectParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v9/projects/${params.projectId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'PATCH',
    headers: (params: VercelUpdateProjectParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelUpdateProjectParams) => {
      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name.trim()
      if (params.framework) body.framework = params.framework.trim()
      if (params.buildCommand) body.buildCommand = params.buildCommand.trim()
      if (params.outputDirectory) body.outputDirectory = params.outputDirectory.trim()
      if (params.installCommand) body.installCommand = params.installCommand.trim()
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
        updatedAt: data.updatedAt,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Project ID' },
    name: { type: 'string', description: 'Project name' },
    framework: { type: 'string', description: 'Project framework', optional: true },
    updatedAt: { type: 'number', description: 'Last updated timestamp' },
  },
}
