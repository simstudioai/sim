import type {
  CleanedOutlookFolder,
  OutlookListFoldersParams,
  OutlookListFoldersResponse,
} from '@/tools/outlook/types'
import { OUTLOOK_FOLDER_OUTPUT_PROPERTIES } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

interface OutlookFolderApi {
  id: string
  displayName?: string
  parentFolderId?: string
  childFolderCount?: number
  unreadItemCount?: number
  totalItemCount?: number
  isHidden?: boolean
}

export const outlookListFoldersTool: ToolConfig<
  OutlookListFoldersParams,
  OutlookListFoldersResponse
> = {
  id: 'outlook_list_folders',
  name: 'Outlook List Folders',
  description: 'List mail folders in the root of the Outlook mailbox',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of folders to retrieve (default: 50, max: 100)',
    },
    includeHiddenFolders: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include hidden folders in the results',
    },
  },

  request: {
    url: (params) => {
      const maxResults = params.maxResults
        ? Math.max(1, Math.min(Math.abs(Number(params.maxResults)), 100))
        : 50
      const query = new URLSearchParams({ $top: String(maxResults) })
      if (params.includeHiddenFolders) {
        query.set('includeHiddenFolders', 'true')
      }
      return `https://graph.microsoft.com/v1.0/me/mailFolders?${query.toString()}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const folders: OutlookFolderApi[] = data.value || []

    const cleanedFolders: CleanedOutlookFolder[] = folders.map((folder) => ({
      id: folder.id,
      displayName: folder.displayName ?? null,
      parentFolderId: folder.parentFolderId ?? null,
      childFolderCount: folder.childFolderCount ?? null,
      unreadItemCount: folder.unreadItemCount ?? null,
      totalItemCount: folder.totalItemCount ?? null,
      isHidden: folder.isHidden ?? null,
    }))

    return {
      success: true,
      output: {
        message: `Successfully retrieved ${cleanedFolders.length} folder(s).`,
        results: cleanedFolders,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'array',
      description: 'Array of mail folder objects',
      items: {
        type: 'object',
        properties: OUTLOOK_FOLDER_OUTPUT_PROPERTIES,
      },
    },
  },
}
