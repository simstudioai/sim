import type { OutlookCreateFolderParams, OutlookCreateFolderResponse } from '@/tools/outlook/types'
import { OUTLOOK_FOLDER_OUTPUT_PROPERTIES } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookCreateFolderTool: ToolConfig<
  OutlookCreateFolderParams,
  OutlookCreateFolderResponse
> = {
  id: 'outlook_create_folder',
  name: 'Outlook Create Folder',
  description: 'Create a new mail folder in the root of the Outlook mailbox',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'outlook',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Outlook',
    },
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The display name of the new folder',
    },
    isHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the new folder is hidden (cannot be changed after creation)',
    },
  },

  request: {
    url: () => 'https://graph.microsoft.com/v1.0/me/mailFolders',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const displayName = params.displayName?.trim()
      if (!displayName) {
        throw new Error('A folder display name is required')
      }
      return {
        displayName,
        ...(params.isHidden ? { isHidden: true } : {}),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const folder = await response.json()
    return {
      success: true,
      output: {
        message: `Successfully created folder "${folder.displayName ?? ''}".`,
        results: {
          id: folder.id,
          displayName: folder.displayName ?? null,
          parentFolderId: folder.parentFolderId ?? null,
          childFolderCount: folder.childFolderCount ?? null,
          unreadItemCount: folder.unreadItemCount ?? null,
          totalItemCount: folder.totalItemCount ?? null,
          isHidden: folder.isHidden ?? null,
        },
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'object',
      description: 'The newly created mail folder',
      properties: OUTLOOK_FOLDER_OUTPUT_PROPERTIES,
    },
  },
}
