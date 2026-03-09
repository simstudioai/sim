import type { HexCancelRunParams, HexCancelRunResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const cancelRunTool: ToolConfig<HexCancelRunParams, HexCancelRunResponse> = {
  id: 'hex_cancel_run',
  name: 'Hex Cancel Run',
  description: 'Cancel an active Hex project run.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the Hex project',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the run to cancel',
    },
  },

  request: {
    url: (params) =>
      `https://app.hex.tech/api/v1/projects/${params.projectId}/runs/${params.runId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          success: true,
          projectId: params?.projectId ?? '',
          runId: params?.runId ?? '',
        },
      }
    }

    const data = await response.json().catch(() => ({}))
    return {
      success: false,
      output: {
        success: false,
        projectId: params?.projectId ?? '',
        runId: params?.runId ?? '',
      },
      error: (data as Record<string, string>).message ?? 'Failed to cancel run',
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the run was successfully cancelled' },
    projectId: { type: 'string', description: 'Project UUID' },
    runId: { type: 'string', description: 'Run UUID that was cancelled' },
  },
}
