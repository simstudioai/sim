import { encodeJupyterPath, parseJupyterContentModel } from '@/lib/internal/jupyter/protocol'
import type {
  JupyterGetContentParams,
  JupyterGetContentResponse,
  JupyterGetContentV2Response,
} from '@/tools/jupyter/types'
import type { InternalToolConfig } from '@/tools/types'

export const jupyterGetContentTool = {
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

  operation: {
    input: (params) => ({
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
} satisfies InternalToolConfig<JupyterGetContentParams, JupyterGetContentResponse>

export const jupyterGetContentV2Tool: InternalToolConfig<
  JupyterGetContentParams,
  JupyterGetContentV2Response
> = {
  ...jupyterGetContentTool,
  id: 'jupyter_get_content_v2',
  version: '2.0.0',
  description:
    'Download a file as a stored file, or read structured notebook and directory content',
  operation: {
    input: (params) => ({
      serverUrl: params.serverUrl,
      token: params.token,
      method: 'GET',
      path: params.path,
    }),
  },
  transformResponse: async (response) => response.json(),
  outputs: {
    file: { type: 'file', description: 'Downloaded file', optional: true },
    text: {
      type: 'string',
      description: 'JSON-stringified notebook or directory content',
      optional: true,
    },
    name: { type: 'string', description: 'Notebook or directory name', optional: true },
    path: { type: 'string', description: 'Notebook or directory path', optional: true },
    mimetype: { type: 'string', description: 'Notebook or directory MIME type', optional: true },
  },
}
