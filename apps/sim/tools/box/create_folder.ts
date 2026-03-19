import type { ToolConfig } from '@/tools/types'
import type { BoxCreateFolderParams, BoxFolderResponse } from './types'
import { FOLDER_OUTPUT_PROPERTIES } from './types'

export const boxCreateFolderTool: ToolConfig<BoxCreateFolderParams, BoxFolderResponse> = {
  id: 'box_create_folder',
  name: 'Box Create Folder',
  description: 'Create a new folder in Box',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Box API',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new folder',
    },
    parentFolderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the parent folder (use "0" for root)',
    },
  },

  request: {
    url: 'https://api.box.com/2.0/folders',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      name: params.name,
      parent: { id: params.parentFolderId.trim() },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `Box API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? '',
        createdAt: data.created_at ?? null,
        modifiedAt: data.modified_at ?? null,
        parentId: data.parent?.id ?? null,
        parentName: data.parent?.name ?? null,
      },
    }
  },

  outputs: FOLDER_OUTPUT_PROPERTIES,
}
