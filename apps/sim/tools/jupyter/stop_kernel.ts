import type { JupyterStopKernelParams, JupyterStopKernelResponse } from '@/tools/jupyter/types'
import { buildJupyterAuthHeaders, normalizeJupyterServerUrl } from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterStopKernelTool: ToolConfig<JupyterStopKernelParams, JupyterStopKernelResponse> =
  {
    id: 'jupyter_stop_kernel',
    name: 'Jupyter Stop Kernel',
    description: 'Shut down a running kernel on a Jupyter server',
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
        description: 'ID of the kernel to shut down',
      },
    },

    request: {
      url: (params) =>
        `${normalizeJupyterServerUrl(params.serverUrl)}/api/kernels/${encodeURIComponent(params.kernelId)}`,
      method: 'DELETE',
      headers: (params) => buildJupyterAuthHeaders(params.token),
    },

    transformResponse: async (response, params) => {
      if (!response.ok && response.status !== 204) {
        const errorText = await response.text()
        return {
          success: false,
          error: `Jupyter API error: ${response.status} ${errorText}`,
          output: { success: false, kernelId: params?.kernelId ?? '' },
        }
      }

      return {
        success: true,
        output: { success: true, kernelId: params?.kernelId ?? '' },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Whether the kernel was shut down' },
      kernelId: { type: 'string', description: 'Shut down kernel ID' },
    },
  }
