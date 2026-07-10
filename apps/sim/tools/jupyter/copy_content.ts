import type { JupyterCopyContentParams, JupyterCopyContentResponse } from '@/tools/jupyter/types'
import {
  assertSafeJupyterPath,
  encodeJupyterPath,
  parseJupyterContentModel,
} from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterCopyContentTool: ToolConfig<
  JupyterCopyContentParams,
  JupyterCopyContentResponse
> = {
  id: 'jupyter_copy_content',
  name: 'Jupyter Copy Content',
  description: 'Duplicate a file or notebook into a directory on a Jupyter server',
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
      description: 'Destination directory path, relative to the server root',
    },
    copyFromPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path of the file or notebook to copy, relative to the server root',
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
      path: `contents/${encodeJupyterPath(params.path)}`,
      body: { copy_from: assertSafeJupyterPath(params.copyFromPath) },
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Jupyter API error: ${response.status} ${errorText}`,
        output: { name: '', path: params?.path ?? '', createdAt: null },
      }
    }

    const data = parseJupyterContentModel(await response.json()) ?? {}

    return {
      success: true,
      output: {
        name: data.name ?? '',
        path: data.path ?? params?.path ?? '',
        createdAt: data.created ?? null,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Name of the copied entry' },
    path: { type: 'string', description: 'Path of the copied entry' },
    createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  },
}
