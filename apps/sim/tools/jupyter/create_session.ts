import type {
  JupyterCreateSessionParams,
  JupyterCreateSessionResponse,
} from '@/tools/jupyter/types'
import {
  assertSafeJupyterPath,
  buildJupyterAuthHeaders,
  mapJupyterSession,
  normalizeJupyterServerUrl,
} from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterCreateSessionTool: ToolConfig<
  JupyterCreateSessionParams,
  JupyterCreateSessionResponse
> = {
  id: 'jupyter_create_session',
  name: 'Jupyter Create Session',
  description: 'Create a session that binds a notebook path to a (new or existing) kernel',
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
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Notebook path to bind the session to, relative to the server root',
    },
    kernelName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Kernel spec name to start for this session (e.g. python3)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional session name',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Session type, defaults to 'notebook'",
    },
  },

  request: {
    url: (params) => `${normalizeJupyterServerUrl(params.serverUrl)}/api/sessions`,
    method: 'POST',
    headers: (params) => ({
      ...buildJupyterAuthHeaders(params.token),
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      path: assertSafeJupyterPath(params.path),
      name: params.name,
      type: params.type || 'notebook',
      ...(params.kernelName ? { kernel: { name: params.kernelName } } : {}),
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Jupyter API error: ${response.status} ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: mapJupyterSession(data),
    }
  },

  outputs: {
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
        lastActivity: { type: 'string', description: 'Last activity timestamp', optional: true },
        executionState: {
          type: 'string',
          description: 'Kernel execution state',
          optional: true,
        },
        connections: { type: 'number', description: 'Active connection count', optional: true },
      },
    },
  },
}
