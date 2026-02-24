import type { GongGetFolderContentParams, GongGetFolderContentResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const getFolderContentTool: ToolConfig<
  GongGetFolderContentParams,
  GongGetFolderContentResponse
> = {
  id: 'gong_get_folder_content',
  name: 'Gong Get Folder Content',
  description: 'Retrieve the list of calls in a specific library folder from Gong.',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    folderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The library folder ID to retrieve content for',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/library/folder-content')
      url.searchParams.set('folderId', params.folderId)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to get folder content')
    }
    const calls = (data.calls ?? []).map((c: Record<string, unknown>) => ({
      id: (c.id as string) ?? '',
      title: c.title ?? null,
      note: c.note ?? null,
      addedBy: c.addedBy ?? null,
      created: c.created ?? null,
      url: c.url ?? null,
      snippet: c.snippet
        ? {
            fromSec: (c.snippet as Record<string, unknown>).fromSec ?? null,
            toSec: (c.snippet as Record<string, unknown>).toSec ?? null,
          }
        : null,
    }))
    return {
      success: true,
      output: {
        folderId: data.id ?? null,
        folderName: data.name ?? null,
        createdBy: data.createdBy ?? null,
        updated: data.updated ?? null,
        calls,
      },
    }
  },

  outputs: {
    folderId: {
      type: 'string',
      description: "Gong's unique numeric identifier for the folder",
    },
    folderName: {
      type: 'string',
      description: 'Display name of the folder',
    },
    createdBy: {
      type: 'string',
      description: "Gong's unique numeric identifier for the user who added the folder",
    },
    updated: {
      type: 'string',
      description: "Folder's last update time in ISO-8601 format",
    },
    calls: {
      type: 'array',
      description: 'List of calls in the library folder',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Gong unique numeric identifier of the call' },
          title: { type: 'string', description: 'The title of the call' },
          note: { type: 'string', description: 'A note attached to the call in the folder' },
          addedBy: {
            type: 'string',
            description: 'Gong unique numeric identifier for the user who added the call',
          },
          created: {
            type: 'string',
            description: 'Date and time the call was added to folder in ISO-8601 format',
          },
          url: { type: 'string', description: 'URL of the call' },
          snippet: {
            type: 'object',
            description: 'Call snippet time range',
            properties: {
              fromSec: {
                type: 'number',
                description: 'Snippet start in seconds relative to call start',
              },
              toSec: {
                type: 'number',
                description: 'Snippet end in seconds relative to call start',
              },
            },
          },
        },
      },
    },
  },
}
