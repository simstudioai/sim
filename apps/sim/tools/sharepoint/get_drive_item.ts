import type {
  SharepointDriveItem,
  SharepointGetDriveItemResponse,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import { optionalTrim } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const getDriveItemTool: ToolConfig<SharepointToolParams, SharepointGetDriveItemResponse> = {
  id: 'sharepoint_get_drive_item',
  name: 'Get SharePoint Drive Item',
  description: 'Get metadata for a file or folder in a SharePoint document library',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'sharepoint',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the SharePoint API',
    },
    driveId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the document library (drive). Example: b!abc123def456',
    },
    driveItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file or folder (drive item) to retrieve',
    },
  },

  request: {
    url: (params) => {
      const driveId = optionalTrim(params.driveId)
      const driveItemId = optionalTrim(params.driveItemId)
      if (!driveId) throw new Error('driveId must be provided')
      if (!driveItemId) throw new Error('driveItemId must be provided')
      return `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(driveItemId)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data: Record<string, unknown> = await response.json()

    const driveItem: SharepointDriveItem = {
      id: data.id as string,
      name: data.name as string,
      webUrl: data.webUrl as string | undefined,
      size: data.size as number | undefined,
      createdDateTime: data.createdDateTime as string | undefined,
      lastModifiedDateTime: data.lastModifiedDateTime as string | undefined,
      file: (data.file as SharepointDriveItem['file']) ?? null,
      folder: (data.folder as SharepointDriveItem['folder']) ?? null,
      parentReference: (data.parentReference as SharepointDriveItem['parentReference']) ?? null,
    }

    return {
      success: true,
      output: { driveItem },
    }
  },

  outputs: {
    driveItem: {
      type: 'object',
      description: 'Metadata for the SharePoint file or folder',
      properties: {
        id: { type: 'string', description: 'The unique ID of the drive item' },
        name: { type: 'string', description: 'The name of the file or folder' },
        webUrl: { type: 'string', description: 'The URL to access the item' },
        size: { type: 'number', description: 'The size of the item in bytes', optional: true },
        createdDateTime: { type: 'string', description: 'When the item was created' },
        lastModifiedDateTime: { type: 'string', description: 'When the item was last modified' },
        file: {
          type: 'object',
          description: 'Present if the item is a file (contains mimeType)',
          optional: true,
        },
        folder: {
          type: 'object',
          description: 'Present if the item is a folder (contains childCount)',
          optional: true,
        },
        parentReference: {
          type: 'object',
          description: 'Reference to the parent folder/drive',
          optional: true,
        },
      },
    },
  },
}
