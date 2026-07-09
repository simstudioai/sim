import type { JupyterListContentsParams, JupyterListContentsResponse } from '@/tools/jupyter/types'
import {
  buildJupyterAuthHeaders,
  encodeJupyterPath,
  normalizeJupyterServerUrl,
} from '@/tools/jupyter/utils'
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
    url: (params) => {
      const base = normalizeJupyterServerUrl(params.serverUrl)
      const path = encodeJupyterPath(params.path)
      return `${base}/api/contents/${path}?type=directory&content=1`
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
        output: { items: [], path: params?.path ?? '' },
      }
    }

    const data = await response.json()
    const items = Array.isArray(data.content) ? data.content : []

    return {
      success: true,
      output: {
        items: items.map((item: Record<string, unknown>) => ({
          name: item.name,
          path: item.path,
          type: item.type,
          writable: Boolean(item.writable),
          created: (item.created as string | undefined) ?? null,
          lastModified: (item.last_modified as string | undefined) ?? null,
          size: (item.size as number | undefined) ?? null,
          mimetype: (item.mimetype as string | undefined) ?? null,
          format: (item.format as string | undefined) ?? null,
        })),
        path: (data.path as string | undefined) ?? params?.path ?? '',
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
