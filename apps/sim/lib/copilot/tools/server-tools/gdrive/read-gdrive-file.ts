import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { executeTool } from '@/tools'
import { BaseCopilotTool } from '../base'

interface ReadGDriveFileParams {
  userId: string
  fileId: string
  type: 'doc' | 'sheet'
  range?: string
}

interface ReadGDriveFileResult {
  type: 'doc' | 'sheet'
  content?: string
  rows?: string[][]
  range?: string
  metadata?: Record<string, any>
}

class ReadGDriveFileTool extends BaseCopilotTool<ReadGDriveFileParams, ReadGDriveFileResult> {
  readonly id = 'read_gdrive_file'
  readonly displayName = 'Reading Google Drive file'

  protected async executeImpl(params: ReadGDriveFileParams): Promise<ReadGDriveFileResult> {
    const logger = createLogger('ReadGDriveFileTool')

    const { userId, fileId, type, range } = params

    if (!userId || !fileId || !type) {
      throw new Error('userId, fileId and type are required')
    }

    if (type === 'doc') {
      const accessToken = await getOAuthToken(userId, 'google-drive')
      if (!accessToken) {
        throw new Error(
          'No Google Drive connection found for this user. Please connect Google Drive in settings.'
        )
      }

      const result = await executeTool('google_drive_get_content', { accessToken, fileId }, true)

      if (!result.success) {
        throw new Error(result.error || 'Failed to read Google Drive document')
      }

      const output = result.output as any
      const content = output?.output?.content ?? output?.content
      const metadata = output?.output?.metadata ?? output?.metadata

      return { type, content, metadata }
    }

    if (type === 'sheet') {
      const accessToken = await getOAuthToken(userId, 'google-sheets')
      if (!accessToken) {
        throw new Error(
          'No Google Sheets connection found for this user. Please connect Google Sheets in settings.'
        )
      }

      const result = await executeTool(
        'google_sheets_read',
        { accessToken, spreadsheetId: fileId, ...(range ? { range } : {}) },
        true
      )

      if (!result.success) {
        throw new Error(result.error || 'Failed to read Google Sheets data')
      }

      const output = result.output as any
      const rows: string[][] = output?.output?.data?.values || output?.data?.values || []
      const resolvedRange: string | undefined = output?.output?.data?.range || output?.data?.range
      const metadata = output?.output?.metadata || output?.metadata

      return { type, rows, range: resolvedRange, metadata }
    }

    throw new Error(`Unsupported type: ${type}`)
  }
}

export const readGDriveFileTool = new ReadGDriveFileTool()
