import type { JupyterListSessionsParams, JupyterListSessionsResponse } from '@/tools/jupyter/types'
import { mapJupyterSession } from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterListSessionsTool: ToolConfig<
  JupyterListSessionsParams,
  JupyterListSessionsResponse
> = {
  id: 'jupyter_list_sessions',
  name: 'Jupyter List Sessions',
  description: 'List active sessions (notebook-to-kernel bindings) on a Jupyter server',
  version: '1.0.0',

  params: {
    serverUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Base URL of the Jupyter server (e.g. http://localhost:8888)',
    },
    token: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jupyter server authentication token',
    },
  },

  request: {
    url: '/api/tools/jupyter/proxy',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      serverUrl: params.serverUrl,
      token: params.token,
      method: 'GET',
      path: 'sessions',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Jupyter API error: ${response.status} ${errorText}`,
        output: { sessions: [] },
      }
    }

    const data = await response.json()
    const sessions = Array.isArray(data) ? data : []

    return {
      success: true,
      output: { sessions: sessions.map(mapJupyterSession) },
    }
  },

  outputs: {
    sessions: {
      type: 'array',
      description: 'Active sessions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session ID' },
          path: { type: 'string', description: 'Notebook path bound to this session' },
          name: { type: 'string', description: 'Session name' },
          type: { type: 'string', description: 'Session type' },
          kernel: {
            type: 'object',
            description: 'Kernel bound to this session',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Kernel ID' },
              name: { type: 'string', description: 'Kernel spec name' },
              lastActivity: {
                type: 'string',
                description: 'Last activity timestamp',
                optional: true,
              },
              executionState: {
                type: 'string',
                description: 'Kernel execution state',
                optional: true,
              },
              connections: {
                type: 'number',
                description: 'Active connection count',
                optional: true,
              },
            },
          },
        },
      },
    },
  },
}
