import type {
  JupyterDeleteSessionParams,
  JupyterDeleteSessionResponse,
} from '@/tools/jupyter/types'
import type { ToolConfig } from '@/tools/types'

export const jupyterDeleteSessionTool: ToolConfig<
  JupyterDeleteSessionParams,
  JupyterDeleteSessionResponse
> = {
  id: 'jupyter_delete_session',
  name: 'Jupyter Delete Session',
  description: 'Delete a session on a Jupyter server (does not shut down its kernel)',
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
    sessionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the session to delete',
    },
  },

  request: {
    url: '/api/tools/jupyter/proxy',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      serverUrl: params.serverUrl,
      token: params.token,
      method: 'DELETE',
      path: `sessions/${encodeURIComponent(params.sessionId)}`,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Jupyter API error: ${response.status} ${errorText}`,
        output: { success: false, sessionId: params?.sessionId ?? '' },
      }
    }

    return {
      success: true,
      output: { success: true, sessionId: params?.sessionId ?? '' },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the session was deleted' },
    sessionId: { type: 'string', description: 'Deleted session ID' },
  },
}
