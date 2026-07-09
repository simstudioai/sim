import type {
  JupyterInterruptKernelParams,
  JupyterInterruptKernelResponse,
} from '@/tools/jupyter/types'
import { buildJupyterAuthHeaders, normalizeJupyterServerUrl } from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterInterruptKernelTool: ToolConfig<
  JupyterInterruptKernelParams,
  JupyterInterruptKernelResponse
> = {
  id: 'jupyter_interrupt_kernel',
  name: 'Jupyter Interrupt Kernel',
  description: 'Interrupt a running kernel on a Jupyter server',
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
      description: 'ID of the kernel to interrupt',
    },
  },

  request: {
    url: (params) =>
      `${normalizeJupyterServerUrl(params.serverUrl)}/api/kernels/${encodeURIComponent(params.kernelId)}/interrupt`,
    method: 'POST',
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
    success: { type: 'boolean', description: 'Whether the interrupt was sent' },
    kernelId: { type: 'string', description: 'Interrupted kernel ID' },
  },
}
