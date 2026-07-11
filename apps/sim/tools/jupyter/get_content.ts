import type { JupyterGetContentParams, JupyterGetContentResponse } from '@/tools/jupyter/types'
import { encodeJupyterPath, parseJupyterContentModel } from '@/tools/jupyter/utils'
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
      url: '/api/tools/jupyter/proxy',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        serverUrl: params.serverUrl,
        token: params.token,
        method: 'GET',
        path: `contents/${encodeJupyterPath(params.path)}?content=1`,
      }),
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

      const data = parseJupyterContentModel(await response.json()) ?? {}
      const format = data.format
      const name = data.name ?? params?.path?.split('/').pop() ?? 'file'
      const mimetype = data.mimetype ?? null

      if (format === 'base64' && typeof data.content === 'string') {
        const buffer = Buffer.from(data.content, 'base64')
        return {
          success: true,
          output: {
            name,
            path: data.path ?? params?.path ?? '',
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
          : typeof data.content === 'string'
            ? data.content
            : null

      return {
        success: true,
        output: {
          name,
          path: data.path ?? params?.path ?? '',
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
