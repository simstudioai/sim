import type { JupyterListContentsParams, JupyterListContentsResponse } from '@/tools/jupyter/types'
import { encodeJupyterPath, parseJupyterContentModel } from '@/tools/jupyter/utils'
import type { ToolConfig } from '@/tools/types'

export const jupyterListContentsTool: ToolConfig<
  JupyterListContentsParams,
  JupyterListContentsResponse
> = {
  id: 'jupyter_list_contents',
  name: 'Jupyter List Contents',
  description: 'List files, notebooks, and subdirectories at a path on a Jupyter server',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Directory path to list, relative to the server root. Leave blank for root.',
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
      path: `contents/${encodeJupyterPath(params.path)}?type=directory&content=1`,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Jupyter API error: ${response.status} ${errorText}`,
        output: { items: [], path: params?.path ?? '' },
      }
    }

    const data = parseJupyterContentModel(await response.json()) ?? {}
    const items = Array.isArray(data.content) ? data.content : []

    return {
      success: true,
      output: {
        items: items.map((item) => {
          const content = parseJupyterContentModel(item) ?? {}
          return {
            name: content.name ?? '',
            path: content.path ?? '',
            type: content.type ?? 'file',
            writable: content.writable ?? false,
            created: content.created ?? null,
            lastModified: content.lastModified ?? null,
            size: content.size ?? null,
            mimetype: content.mimetype ?? null,
            format: content.format ?? null,
          }
        }),
        path: data.path ?? params?.path ?? '',
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Directory entries at the requested path',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Entry name' },
          path: { type: 'string', description: 'Entry path relative to server root' },
          type: { type: 'string', description: 'directory, file, or notebook' },
          writable: { type: 'boolean', description: 'Whether the entry is writable' },
          created: { type: 'string', description: 'Creation timestamp', optional: true },
          lastModified: {
            type: 'string',
            description: 'Last modified timestamp',
            optional: true,
          },
          size: { type: 'number', description: 'Size in bytes', optional: true },
          mimetype: { type: 'string', description: 'MIME type (files only)', optional: true },
          format: { type: 'string', description: 'json, text, or base64', optional: true },
        },
      },
    },
    path: {
      type: 'string',
      description: 'The listed directory path',
    },
  },
}
