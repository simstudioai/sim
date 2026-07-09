import type {
  JupyterListKernelspecsParams,
  JupyterListKernelspecsResponse,
} from '@/tools/jupyter/types'
import { buildJupyterAuthHeaders, normalizeJupyterServerUrl } from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterListKernelspecsTool: ToolConfig<
  JupyterListKernelspecsParams,
  JupyterListKernelspecsResponse
> = {
  id: 'jupyter_list_kernelspecs',
  name: 'Jupyter List Kernel Specs',
  description: 'List available kernel specs (languages/runtimes) on a Jupyter server',
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
    url: (params) => `${normalizeJupyterServerUrl(params.serverUrl)}/api/kernelspecs`,
    method: 'GET',
    headers: (params) => buildJupyterAuthHeaders(params.token),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Jupyter API error: ${response.status} ${errorText}`,
        output: { defaultKernelName: null, kernelspecs: [] },
      }
    }

    const data = await response.json()
    const specs = data.kernelspecs && typeof data.kernelspecs === 'object' ? data.kernelspecs : {}

    return {
      success: true,
      output: {
        defaultKernelName: (data.default as string | undefined) ?? null,
        kernelspecs: Object.entries(specs as Record<string, Record<string, unknown>>).map(
          ([name, entry]) => {
            const spec = (entry.spec as Record<string, unknown> | undefined) ?? {}
            return {
              name: (entry.name as string | undefined) ?? name,
              displayName: (spec.display_name as string | undefined) ?? name,
              language: (spec.language as string | undefined) ?? null,
              argv: Array.isArray(spec.argv) ? (spec.argv as string[]) : [],
              interruptMode: (spec.interrupt_mode as string | undefined) ?? null,
            }
          }
        ),
      },
    }
  },

  outputs: {
    defaultKernelName: { type: 'string', description: 'Default kernel spec name', optional: true },
    kernelspecs: {
      type: 'array',
      description: 'Available kernel specs',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Kernel spec name' },
          displayName: { type: 'string', description: 'Human-readable display name' },
          language: { type: 'string', description: 'Kernel language', optional: true },
          argv: { type: 'array', description: 'Launch command arguments' },
          interruptMode: { type: 'string', description: 'Interrupt mode', optional: true },
        },
      },
    },
  },
}
