import type {
  JupyterDeleteContentParams,
  JupyterDeleteContentResponse,
} from '@/tools/jupyter/types'
import { encodeJupyterPath } from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterDeleteContentTool: ToolConfig<
  JupyterDeleteContentParams,
  JupyterDeleteContentResponse
> = {
  id: 'jupyter_delete_content',
  name: 'Jupyter Delete Content',
  description: 'Delete a file, notebook, or directory on a Jupyter server',
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
      description: 'Path of the entry to delete, relative to the server root',
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
      path: `contents/${encodeJupyterPath(params.path)}`,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Jupyter API error: ${response.status} ${errorText}`,
        output: { success: false, path: params?.path ?? '' },
      }
    }

    return {
      success: true,
      output: { success: true, path: params?.path ?? '' },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the entry was deleted' },
    path: { type: 'string', description: 'Deleted entry path' },
  },
}
