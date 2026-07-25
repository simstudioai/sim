import type {
  JupyterRestartKernelParams,
  JupyterRestartKernelResponse,
} from '@/tools/jupyter/types'
import { mapJupyterKernel } from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterRestartKernelTool: ToolConfig<
  JupyterRestartKernelParams,
  JupyterRestartKernelResponse
> = {
  id: 'jupyter_restart_kernel',
  name: 'Jupyter Restart Kernel',
  description: 'Restart a running kernel on a Jupyter server',
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
    kernelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the kernel to restart',
    },
  },

  request: {
    url: '/api/tools/jupyter/proxy',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      serverUrl: params.serverUrl,
      token: params.token,
      method: 'POST',
      path: `kernels/${encodeURIComponent(params.kernelId)}/restart`,
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
