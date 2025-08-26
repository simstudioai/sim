import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken, getUserId } from '@/app/api/auth/oauth/utils'
import { executeTool } from '@/tools'

interface ListGDriveFilesParams {
  userId?: string
  workflowId?: string
  search_query?: string
  searchQuery?: string
  num_results?: number
}

export const listGDriveFilesServerTool: BaseServerTool<ListGDriveFilesParams, any> = {
  name: 'list_gdrive_files',
  async execute(params: ListGDriveFilesParams): Promise<any> {
    const logger = createLogger('ListGDriveFilesServerTool')
    const { search_query, searchQuery, num_results } = params || {}
    let uid = params?.userId
    if (!uid && params?.workflowId) {
      uid = await getUserId('copilot-gdrive-list', params.workflowId)
    }
    if (!uid || typeof uid !== 'string' || uid.trim().length === 0) {
      throw new Error('userId is required')
    }

    const query = search_query ?? searchQuery
    const pageSize = num_results

    const accessToken = await getOAuthToken(uid, 'google-drive')
    if (!accessToken) {
      throw new Error(
        'No Google Drive connection found for this user. Please connect Google Drive in settings.'
      )
    }

    const result = await executeTool(
      'google_drive_list',
      {
        accessToken,
        ...(query ? { query } : {}),
        ...(typeof pageSize === 'number' ? { pageSize } : {}),
      },
      true
    )
    if (!result.success) {
      throw new Error(result.error || 'Failed to list Google Drive files')
    }
    const output = (result as any).output || result
    const files = Array.isArray(output?.files) ? output.files : output?.output?.files || []
    const nextPageToken = output?.nextPageToken || output?.output?.nextPageToken
    logger.info('Listed Google Drive files', { count: files.length })
    return { files, total: files.length, nextPageToken }
  },
}
