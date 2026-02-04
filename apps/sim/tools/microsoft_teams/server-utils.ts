/**
 * Server-side utilities for Microsoft Teams integration.
 * This file contains functions that require server-side dependencies and should
 * only be imported by API routes, NOT by tool definitions (to avoid circular imports).
 */
import type { Logger } from '@sim/logger'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'
import type { GraphApiErrorResponse, GraphDriveItem } from '@/tools/microsoft_teams/types'

/** Maximum file size for Teams direct upload (4MB) */
const MAX_TEAMS_FILE_SIZE = 4 * 1024 * 1024

/** Output format for uploaded files */
export interface TeamsFileOutput {
  name: string
  mimeType: string
  data: string
  size: number
}

/** Attachment reference for Teams message */
export interface TeamsAttachmentRef {
  id: string
  contentType: 'reference'
  contentUrl: string
  name: string
}

/** Result from processing and uploading files for Teams */
export interface TeamsFileUploadResult {
  attachments: TeamsAttachmentRef[]
  filesOutput: TeamsFileOutput[]
}

/**
 * Process and upload files to OneDrive for Teams message attachments.
 * Handles size validation, downloading from storage, uploading to OneDrive,
 * and creating attachment references.
 */
export async function uploadFilesForTeamsMessage(params: {
  rawFiles: RawFileInput[]
  accessToken: string
  requestId: string
  logger: Logger
}): Promise<TeamsFileUploadResult> {
  const { rawFiles, accessToken, requestId, logger: log } = params
  const attachments: TeamsAttachmentRef[] = []
  const filesOutput: TeamsFileOutput[] = []

  if (!rawFiles || rawFiles.length === 0) {
    return { attachments, filesOutput }
  }

  log.info(`[${requestId}] Processing ${rawFiles.length} file(s) for upload to OneDrive`)

  const userFiles = processFilesToUserFiles(rawFiles, requestId, log) as UserFile[]

  for (const file of userFiles) {
    // Check size limit
    if (file.size > MAX_TEAMS_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2)
      log.error(
        `[${requestId}] File ${file.name} is ${sizeMB}MB, exceeds 4MB limit for direct upload`
      )
      throw new Error(
        `File "${file.name}" (${sizeMB}MB) exceeds the 4MB limit for Teams attachments. Use smaller files or upload to SharePoint/OneDrive first.`
      )
    }

    log.info(`[${requestId}] Uploading file to Teams: ${file.name} (${file.size} bytes)`)

    // Download file from storage
    const buffer = await downloadFileFromStorage(file, requestId, log)
    filesOutput.push({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      data: buffer.toString('base64'),
      size: buffer.length,
    })

    // Upload to OneDrive
    const uploadUrl =
      'https://graph.microsoft.com/v1.0/me/drive/root:/TeamsAttachments/' +
      encodeURIComponent(file.name) +
      ':/content'

    log.info(`[${requestId}] Uploading to OneDrive: ${uploadUrl}`)

    const uploadResponse = await secureFetchWithValidation(
      uploadUrl,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: buffer,
      },
      'uploadUrl'
    )

    if (!uploadResponse.ok) {
      const errorData = (await uploadResponse.json().catch(() => ({}))) as GraphApiErrorResponse
      log.error(`[${requestId}] Teams upload failed:`, errorData)
      throw new Error(
        `Failed to upload file to Teams: ${errorData.error?.message || 'Unknown error'}`
      )
    }

    const uploadedFile = (await uploadResponse.json()) as GraphDriveItem
    log.info(`[${requestId}] File uploaded to OneDrive successfully`, {
      id: uploadedFile.id,
      webUrl: uploadedFile.webUrl,
    })

    // Get file details for attachment reference
    // Note: webDavUrl requires 'select' without the '$' prefix to be reliably returned
    const fileDetailsUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${uploadedFile.id}?select=id,name,webDavUrl,eTag,size`

    const fileDetailsResponse = await secureFetchWithValidation(
      fileDetailsUrl,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      'fileDetailsUrl'
    )

    if (!fileDetailsResponse.ok) {
      const errorData = (await fileDetailsResponse
        .json()
        .catch(() => ({}))) as GraphApiErrorResponse
      log.error(`[${requestId}] Failed to get file details:`, errorData)
      throw new Error(`Failed to get file details: ${errorData.error?.message || 'Unknown error'}`)
    }

    const fileDetails = (await fileDetailsResponse.json()) as GraphDriveItem
    log.info(`[${requestId}] Got file details`, {
      webDavUrl: fileDetails.webDavUrl,
      eTag: fileDetails.eTag,
    })

    // Validate webDavUrl is present (required for Teams attachment references)
    if (!fileDetails.webDavUrl) {
      log.error(`[${requestId}] webDavUrl missing from file details`, { fileId: uploadedFile.id })
      throw new Error(
        `Failed to get file URL for attachment "${file.name}". The file was uploaded but Teams attachment reference could not be created.`
      )
    }

    // Create attachment reference
    const attachmentId = fileDetails.eTag?.match(/\{([a-f0-9-]+)\}/i)?.[1] || fileDetails.id

    attachments.push({
      id: attachmentId,
      contentType: 'reference',
      contentUrl: fileDetails.webDavUrl,
      name: file.name,
    })

    log.info(`[${requestId}] Created attachment reference for ${file.name}`)
  }

  log.info(
    `[${requestId}] All ${attachments.length} file(s) uploaded and attachment references created`
  )

  return { attachments, filesOutput }
}
