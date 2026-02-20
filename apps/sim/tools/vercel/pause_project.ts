import type { ToolConfig } from '@/tools/types'
import type { VercelPauseProjectParams, VercelPauseProjectResponse } from '@/tools/vercel/types'

export const vercelPauseProjectTool: ToolConfig<
  VercelPauseProjectParams,
  VercelPauseProjectResponse
> = {
  id: 'vercel_pause_project',
  name: 'Vercel Pause Project',
  description: 'Pause a Vercel project',
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
    url: (params: VercelPauseProjectParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/projects/${params.projectId.trim()}/pause${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelPauseProjectParams) => ({
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
        paused: data.paused ?? true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Project ID' },
    name: { type: 'string', description: 'Project name' },
    paused: { type: 'boolean', description: 'Whether the project is paused' },
  },
}
