import type { JupyterStartKernelParams, JupyterStartKernelResponse } from '@/tools/jupyter/types'
import {
  buildJupyterAuthHeaders,
  mapJupyterKernel,
  normalizeJupyterServerUrl,
} from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterStartKernelTool: ToolConfig<
  JupyterStartKernelParams,
  JupyterStartKernelResponse
> = {
  id: 'jupyter_start_kernel',
  name: 'Jupyter Start Kernel',
  description: 'Start a new kernel on a Jupyter server',
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
    kernelName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Kernel spec name to start (e.g. python3). Defaults to the server default.',
    },
  },

  request: {
    url: (params) => `${normalizeJupyterServerUrl(params.serverUrl)}/api/kernels`,
    method: 'POST',
    headers: (params) => ({
      ...buildJupyterAuthHeaders(params.token),
      'Content-Type': 'application/json',
    }),
    body: (params) => (params.kernelName ? { name: params.kernelName } : {}),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Jupyter API error: ${response.status} ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: mapJupyterKernel(data),
    }
  },

  outputs: {
    id: { type: 'string', description: 'Kernel ID' },
    name: { type: 'string', description: 'Kernel spec name' },
    lastActivity: { type: 'string', description: 'Last activity timestamp', optional: true },
    executionState: { type: 'string', description: 'Kernel execution state', optional: true },
    connections: { type: 'number', description: 'Active connection count', optional: true },
  },
}
