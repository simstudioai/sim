import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken, getUserId } from '@/app/api/auth/oauth/utils'
import { executeTool } from '@/tools'

interface ReadGDriveFileParams {
  userId?: string
  workflowId?: string
  fileId?: string
  file_id?: string
  // Accept common alternate identifiers
  id?: string
  spreadsheetId?: string
  documentId?: string
  url?: string
  link?: string
  webViewLink?: string
  type?: 'doc' | 'sheet' | 'document' | 'spreadsheet'
  range?: string
}

function extractIdAndTypeFromUrl(urlString?: string): { fileId?: string; type?: 'doc' | 'sheet' } {
  if (!urlString) return {}
  try {
    const url = new URL(urlString)
    const host = url.hostname
    const pathname = url.pathname

    // docs.google.com/document/d/{id}/...
    if (host.includes('docs.google.com') && pathname.includes('/document/')) {
      const parts = pathname.split('/').filter(Boolean)
      const dIndex = parts.indexOf('d')
      const id = dIndex >= 0 && parts[dIndex + 1] ? parts[dIndex + 1] : undefined
      return { fileId: id, type: 'doc' }
    }

    // docs.google.com/spreadsheets/d/{id}/...
    if (host.includes('docs.google.com') && pathname.includes('/spreadsheets/')) {
      const parts = pathname.split('/').filter(Boolean)
      const dIndex = parts.indexOf('d')
      const id = dIndex >= 0 && parts[dIndex + 1] ? parts[dIndex + 1] : undefined
      return { fileId: id, type: 'sheet' }
    }

    // drive.google.com/file/d/{id}/view
    if (host.includes('drive.google.com') && pathname.includes('/file/')) {
      const parts = pathname.split('/').filter(Boolean)
      const dIndex = parts.indexOf('d')
      const id = dIndex >= 0 && parts[dIndex + 1] ? parts[dIndex + 1] : undefined
      return { fileId: id, type: 'doc' }
    }
  } catch {}
  return {}
}

export const readGDriveFileServerTool: BaseServerTool<ReadGDriveFileParams, any> = {
  name: 'read_gdrive_file',
  async execute(params: ReadGDriveFileParams): Promise<any> {
    const logger = createLogger('ReadGDriveFileServerTool')

    // Normalize inputs
    let userId = params?.userId
    // Always try to resolve from workflow or session when not provided
    if (!userId) {
      userId = await getUserId('copilot-gdrive-read', params?.workflowId)
    }

    // Normalize fileId from multiple possible fields
    let fileId =
      params?.fileId || params?.file_id || params?.id || params?.spreadsheetId || params?.documentId

    // If a URL/link is passed, extract id and possibly type
    if (!fileId && (params?.url || params?.link || params?.webViewLink)) {
      const { fileId: extractedId, type: extractedType } = extractIdAndTypeFromUrl(
        params.url || params.link || params.webViewLink
      )
      fileId = extractedId || fileId
      if (!params?.type && extractedType) params.type = extractedType
    }

    let type = params?.type as string | undefined
    if (type === 'document' || type === 'docs') type = 'doc'
    if (type === 'spreadsheet' || type === 'sheets') type = 'sheet'

    // Infer type from provided identifiers if still missing
    if (!type) {
      if (params?.spreadsheetId) type = 'sheet'
      else if (params?.documentId) type = 'doc'
    }

    logger.info('read_gdrive_file input', {
      hasUserId: !!userId,
      hasWorkflowId: !!params?.workflowId,
      hasFileId: !!fileId,
      type,
      hasRange: !!params?.range,
    })

    if (!userId || !fileId || !type) throw new Error('userId, fileId and type are required')

    if (type === 'doc') {
      const accessToken = await getOAuthToken(userId, 'google-drive')
      if (!accessToken)
        throw new Error(
          'No Google Drive connection found for this user. Please connect Google Drive in settings.'
        )
      const result = await executeTool('google_drive_get_content', { accessToken, fileId }, true)
      if (!result.success) throw new Error(result.error || 'Failed to read Google Drive document')
      const output = (result as any).output || result
      const content = output?.output?.content ?? output?.content
      const metadata = output?.output?.metadata ?? output?.metadata
      return { type, content, metadata }
    }

    if (type === 'sheet') {
      const accessToken = await getOAuthToken(userId, 'google-sheets')
      if (!accessToken)
        throw new Error(
          'No Google Sheets connection found for this user. Please connect Google Sheets in settings.'
        )
      const result = await executeTool(
        'google_sheets_read',
        { accessToken, spreadsheetId: fileId, ...(params?.range ? { range: params.range } : {}) },
        true
      )
      if (!result.success) throw new Error(result.error || 'Failed to read Google Sheets data')
      const output = (result as any).output || result
      const rows: string[][] = output?.output?.data?.values || output?.data?.values || []
      const resolvedRange: string | undefined = output?.output?.data?.range || output?.data?.range
      const metadata = output?.output?.metadata || output?.metadata
      return { type, rows, range: resolvedRange, metadata }
    }

    throw new Error(`Unsupported type: ${type}`)
  },
}
