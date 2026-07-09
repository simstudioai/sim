import type { JupyterListKernelsParams, JupyterListKernelsResponse } from '@/tools/jupyter/types'
import {
  buildJupyterAuthHeaders,
  mapJupyterKernel,
  normalizeJupyterServerUrl,
} from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterListKernelsTool: ToolConfig<
  JupyterListKernelsParams,
  JupyterListKernelsResponse
> = {
  id: 'jupyter_list_kernels',
  name: 'Jupyter List Kernels',
  description: 'List running kernels on a Jupyter server',
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
    url: (params) => `${normalizeJupyterServerUrl(params.serverUrl)}/api/kernels`,
    method: 'GET',
    headers: (params) => buildJupyterAuthHeaders(params.token),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Jupyter API error: ${response.status} ${errorText}`,
        output: { kernels: [] },
      }
    }

    const data = await response.json()
    const kernels = Array.isArray(data) ? data : []

    return {
      success: true,
      output: { kernels: kernels.map(mapJupyterKernel) },
    }
  },

  outputs: {
    kernels: {
      type: 'array',
      description: 'Running kernels',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Kernel ID' },
          name: { type: 'string', description: 'Kernel spec name' },
          lastActivity: { type: 'string', description: 'Last activity timestamp', optional: true },
          executionState: { type: 'string', description: 'Kernel execution state', optional: true },
          connections: { type: 'number', description: 'Active connection count', optional: true },
        },
      },
    },
  },
}
