import type {
  MicrosoftGraphDriveItem,
  OneDriveGetItemResponse,
  OneDriveToolParams,
} from '@/tools/onedrive/types'
import {
  DRIVE_ITEM_SELECT,
  ONEDRIVE_FILE_OUTPUT_PROPERTIES,
  toOneDriveFile,
} from '@/tools/onedrive/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getItemTool: ToolConfig<OneDriveToolParams, OneDriveGetItemResponse> = {
  id: 'onedrive_get_item',
  name: 'Get OneDrive Item Metadata',
  description: 'Get metadata for a specific OneDrive file or folder by ID, or the drive root',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'onedrive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the OneDrive API',
    },
    fileId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the file or folder to retrieve (e.g., "01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36M"). Leave empty to get the drive root folder',
    },
  },

  request: {
    url: (params) => {
      const fileId = params.fileId?.trim()
      const baseUrl = fileId
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${safeUrlPathSegment(fileId, 'fileId')}`
        : 'https://graph.microsoft.com/v1.0/me/drive/root'

      const url = new URL(baseUrl)
      url.searchParams.append('$select', DRIVE_ITEM_SELECT)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data: MicrosoftGraphDriveItem = await response.json()

    return {
      success: true,
      output: {
        file: toOneDriveFile(data),
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the item metadata was retrieved' },
    file: {
      type: 'object',
      description:
        'The file or folder metadata, including id, name, webViewLink, size, and timestamps',
      properties: ONEDRIVE_FILE_OUTPUT_PROPERTIES,
    },
  },
}
