import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { executeTool } from '@/tools'
import { BaseCopilotTool } from '../base'

interface ListGDriveFilesParams {
  userId: string
  search_query?: string
  searchQuery?: string
  num_results?: number
}

interface ListGDriveFilesResult {
  files: Array<{
    id: string
    name: string
    mimeType: string
    webViewLink?: string
    webContentLink?: string
    size?: string
    createdTime?: string
    modifiedTime?: string
    parents?: string[]
  }>
  total: number
  nextPageToken?: string
}

class ListGDriveFilesTool extends BaseCopilotTool<ListGDriveFilesParams, ListGDriveFilesResult> {
  readonly id = 'list_gdrive_files'
  readonly displayName = 'Listing Google Drive files'

  protected async executeImpl(params: ListGDriveFilesParams): Promise<ListGDriveFilesResult> {
    const logger = createLogger('ListGDriveFilesTool')

    const { userId } = params
    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      throw new Error('userId is required')
    }

    const query = params.search_query ?? params.searchQuery
    const pageSize = params.num_results

    // Get (and refresh if needed) the user's OAuth access token for Google Drive
    const accessToken = await getOAuthToken(userId, 'google-drive')
    if (!accessToken) {
      throw new Error(
        'No Google Drive connection found for this user. Please connect Google Drive in settings.'
      )
    }

    // Reuse the existing google_drive_list tool
    const result = await executeTool(
      'google_drive_list',
      {
        accessToken,
        ...(query ? { query } : {}),
        ...(typeof pageSize === 'number' ? { pageSize } : {}),
      },
      true // skip proxy; call external API directly from server
    )

    if (!result.success) {
      throw new Error(result.error || 'Failed to list Google Drive files')
    }

    const output = result.output as any
    const files = Array.isArray(output?.files) ? output.files : output?.output?.files || []
    const nextPageToken = output?.nextPageToken || output?.output?.nextPageToken

    return {
      files,
      total: files.length,
      nextPageToken,
    }
  }
}

export const listGDriveFilesTool = new ListGDriveFilesTool()
