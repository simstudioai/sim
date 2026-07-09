import type { JupyterGetContentParams, JupyterGetContentResponse } from '@/tools/jupyter/types'
import {
  buildJupyterAuthHeaders,
  encodeJupyterPath,
  normalizeJupyterServerUrl,
} from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterGetContentTool: ToolConfig<JupyterGetContentParams, JupyterGetContentResponse> =
  {
    id: 'jupyter_get_content',
    name: 'Jupyter Get Content',
    description: 'Read a file or notebook from a Jupyter server',
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
        description: 'Path of the file or notebook to read, relative to the server root',
      },
    },

    request: {
      url: (params) => {
        const base = normalizeJupyterServerUrl(params.serverUrl)
        const path = encodeJupyterPath(params.path)
        return `${base}/api/contents/${path}?content=1`
      },
      method: 'GET',
      headers: (params) => buildJupyterAuthHeaders(params.token),
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
            mimetype: null,
            text: null,
            file: null,
          },
        }
      }

      const data = await response.json()
      const format = data.format as string | undefined
      const name = (data.name as string | undefined) ?? params?.path?.split('/').pop() ?? 'file'
      const mimetype = (data.mimetype as string | undefined) ?? null

      if (format === 'base64' && typeof data.content === 'string') {
        const buffer = Buffer.from(data.content, 'base64')
        return {
          success: true,
          output: {
            name,
            path: (data.path as string | undefined) ?? params?.path ?? '',
            mimetype,
            text: null,
            file: {
              name,
              mimeType: mimetype ?? 'application/octet-stream',
              data: data.content,
              size: buffer.length,
            },
          },
        }
      }

      const text =
        format === 'json' || typeof data.content === 'object'
          ? JSON.stringify(data.content)
          : ((data.content as string | undefined) ?? null)

      return {
        success: true,
        output: {
          name,
          path: (data.path as string | undefined) ?? params?.path ?? '',
          mimetype,
          text,
          file: null,
        },
      }
    },

    outputs: {
      name: { type: 'string', description: 'File or notebook name' },
      path: { type: 'string', description: 'Path relative to the server root' },
      mimetype: { type: 'string', description: 'MIME type of the content', optional: true },
      text: {
        type: 'string',
        description: 'Text content, for text files and notebooks (JSON-stringified)',
        optional: true,
      },
      file: {
        type: 'file',
        description: 'Binary content stored as a file, for base64-format content',
        optional: true,
      },
    },
  }
