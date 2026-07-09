import type { JupyterCreateFileParams, JupyterCreateFileResponse } from '@/tools/jupyter/types'
import {
  buildJupyterAuthHeaders,
  encodeJupyterPath,
  normalizeJupyterServerUrl,
} from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

const EMPTY_NOTEBOOK = { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }

export const jupyterCreateFileTool: ToolConfig<JupyterCreateFileParams, JupyterCreateFileResponse> =
  {
    id: 'jupyter_create_file',
    name: 'Jupyter Create File',
    description: 'Create a file, notebook, or directory on a Jupyter server',
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
        description: 'Path to create, relative to the server root',
      },
      type: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Type of entry to create: file, notebook, or directory',
      },
      content: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Content to write. For a file, plain text. For a notebook, a JSON-stringified nbformat document (defaults to an empty notebook). Ignored for directories.',
      },
    },

    request: {
      url: (params) => {
        const base = normalizeJupyterServerUrl(params.serverUrl)
        const path = encodeJupyterPath(params.path)
        return `${base}/api/contents/${path}`
      },
      method: 'PUT',
      headers: (params) => ({
        ...buildJupyterAuthHeaders(params.token),
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        if (params.type === 'directory') {
          return { type: 'directory' }
        }

        if (params.type === 'notebook') {
          if (!params.content) {
            return { type: 'notebook', format: 'json', content: EMPTY_NOTEBOOK }
          }
          let content: unknown
          try {
            content = JSON.parse(params.content)
          } catch {
            throw new Error('Notebook content must be valid JSON-stringified nbformat')
          }
          return { type: 'notebook', format: 'json', content }
        }

        return { type: 'file', format: 'text', content: params.content ?? '' }
      },
    },

    transformResponse: async (response, params) => {
      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          error: `Jupyter API error: ${response.status} ${errorText}`,
          output: {
            name: '',
            path: params?.path ?? '',
            type: params?.type ?? 'file',
            createdAt: null,
            lastModified: null,
          },
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          name: (data.name as string | undefined) ?? '',
          path: (data.path as string | undefined) ?? params?.path ?? '',
          type: (data.type as 'directory' | 'file' | 'notebook' | undefined) ?? 'file',
          createdAt: (data.created as string | undefined) ?? null,
          lastModified: (data.last_modified as string | undefined) ?? null,
        },
      }
    },

    outputs: {
      name: { type: 'string', description: 'Created entry name' },
      path: { type: 'string', description: 'Created entry path' },
      type: { type: 'string', description: 'directory, file, or notebook' },
      createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
      lastModified: { type: 'string', description: 'Last modified timestamp', optional: true },
    },
  }
