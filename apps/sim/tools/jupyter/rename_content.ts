import type {
  JupyterRenameContentParams,
  JupyterRenameContentResponse,
} from '@/tools/jupyter/types'
import {
  assertSafeJupyterPath,
  buildJupyterAuthHeaders,
  encodeJupyterPath,
  normalizeJupyterServerUrl,
} from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterRenameContentTool: ToolConfig<
  JupyterRenameContentParams,
  JupyterRenameContentResponse
> = {
  id: 'jupyter_rename_content',
  name: 'Jupyter Rename Content',
  description: 'Rename or move a file, notebook, or directory on a Jupyter server',
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
      description: 'Current path of the entry, relative to the server root',
    },
    newPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New path for the entry, relative to the server root',
    },
  },

  request: {
    url: (params) => {
      const base = normalizeJupyterServerUrl(params.serverUrl)
      const path = encodeJupyterPath(params.path)
      return `${base}/api/contents/${path}`
    },
    method: 'PATCH',
    headers: (params) => ({
      ...buildJupyterAuthHeaders(params.token),
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ path: assertSafeJupyterPath(params.newPath) }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Jupyter API error: ${response.status} ${errorText}`,
        output: { name: '', path: params?.newPath ?? '', lastModified: null },
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        name: (data.name as string | undefined) ?? '',
        path: (data.path as string | undefined) ?? params?.newPath ?? '',
        lastModified: (data.last_modified as string | undefined) ?? null,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'New entry name' },
    path: { type: 'string', description: 'New entry path' },
    lastModified: { type: 'string', description: 'Last modified timestamp', optional: true },
  },
}
