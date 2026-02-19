import type { ToolConfig } from '@/tools/types'
import type { VercelUnpauseProjectParams, VercelUnpauseProjectResponse } from '@/tools/vercel/types'

export const vercelUnpauseProjectTool: ToolConfig<
  VercelUnpauseProjectParams,
  VercelUnpauseProjectResponse
> = {
  id: 'vercel_unpause_project',
  name: 'Vercel Unpause Project',
  description: 'Unpause a Vercel project',
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
  },

  request: {
    url: (params: VercelUnpauseProjectParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/projects/${params.projectId.trim()}/unpause${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelUnpauseProjectParams) => ({
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
        paused: data.paused ?? false,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Project ID' },
    name: { type: 'string', description: 'Project name' },
    paused: { type: 'boolean', description: 'Whether the project is paused' },
  },
}
