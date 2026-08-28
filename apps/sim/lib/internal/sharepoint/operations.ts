import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  SharePointClient,
  SharePointGraphError,
  type SharePointUploadedItem,
} from '@/lib/internal/sharepoint/client'
import type {
  SharePointDownloadFileInput,
  SharePointUploadFileInput,
} from '@/lib/internal/sharepoint/schema'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { SharepointSkippedFile, SharepointUploadError } from '@/tools/sharepoint/types'

const logger = createLogger('SharePointOperations')
export const MAX_SHAREPOINT_UPLOAD_BYTES = 250 * 1024 * 1024

export interface SharePointOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

function failureResponse(
  error: string,
  status: number,
  output?: Record<string, unknown>
): Response {
  return Response.json({ success: false, error, ...(output ? { output } : {}) }, { status })
}

function uploadedFile(data: SharePointUploadedItem): SharePointUploadedItem {
  return {
    id: data.id,
    name: data.name,
    webUrl: data.webUrl,
    size: data.size,
    createdDateTime: data.createdDateTime,
    lastModifiedDateTime: data.lastModifiedDateTime,
  }
}

export async function executeSharePointDownloadFile(
  input: SharePointDownloadFileInput,
  context: SharePointOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  try {
    const client = new SharePointClient(input.accessToken, context.signal)
    const metadata = await client.getMetadata(input.driveId, input.itemId)
    if (metadata.folder && !metadata.file) {
      return failureResponse(
        `Cannot download folder "${metadata.name}". Please select a file instead.`,
        400
      )
    }
    const mimeType = metadata.file?.mimeType || 'application/octet-stream'
    const buffer = await client.download(input.driveId, input.itemId)
    context.signal?.throwIfAborted()
    return Response.json({
      success: true,
      output: {
        file: {
          name: input.fileName || metadata.name || 'download',
          mimeType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
      },
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (error instanceof SharePointGraphError) {
      return failureResponse(error.message, error.status)
    }
    logger.error('Error downloading SharePoint file', {
      error: getErrorMessage(error),
      requestId: context.requestId,
    })
    return failureResponse(getErrorMessage(error, 'Unknown error occurred'), 500)
  }
}

function buildUploadUrl(
  input: SharePointUploadFileInput,
  fileName: string
): { url: string; replaceUrl: string } {
  const folderPath = input.folderPath?.trim() || ''
  const normalizedPath = folderPath.startsWith('/') ? folderPath : `/${folderPath}`
  const cleanPath = normalizedPath.endsWith('/') ? normalizedPath.slice(0, -1) : normalizedPath
  const uploadPath = folderPath ? `${cleanPath}/${fileName}` : `/${fileName}`
  const encodedPath = uploadPath
    .split('/')
    .map((segment) => (segment ? encodeURIComponent(segment) : ''))
    .join('/')
  const driveId = input.driveId?.trim()
  const siteId = input.siteId.trim() || 'root'
  const url = driveId
    ? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root:${encodedPath}:/content`
    : `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/drive/root:${encodedPath}:/content`
  return { url, replaceUrl: `${url}?@microsoft.graph.conflictBehavior=replace` }
}

export async function executeSharePointUploadFile(
  input: SharePointUploadFileInput,
  context: SharePointOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  if (!input.files?.length) {
    return failureResponse('At least one file is required for upload', 400)
  }
  const userFiles = processFilesToUserFiles(input.files, context.requestId, logger)
  if (userFiles.length === 0) return failureResponse('No valid files to upload', 400)

  const client = new SharePointClient(input.accessToken, context.signal)
  const uploadedFiles: SharePointUploadedItem[] = []
  const skippedFiles: SharepointSkippedFile[] = []
  const errors: SharepointUploadError[] = []

  try {
    for (const userFile of userFiles) {
      context.signal?.throwIfAborted()
      const denied = await assertToolFileAccess(
        userFile.key,
        context.userId,
        context.requestId,
        logger
      )
      context.signal?.throwIfAborted()
      if (denied) return denied

      const fileName = input.fileName || userFile.name
      const skipOversized = (size: number) => {
        skippedFiles.push({
          name: fileName,
          size,
          limit: MAX_SHAREPOINT_UPLOAD_BYTES,
          reason: 'File exceeds the 250 MB Microsoft Graph small upload limit',
        })
      }

      let buffer: Buffer
      let downloadedContentType = ''
      try {
        const result = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
          maxBytes: MAX_SHAREPOINT_UPLOAD_BYTES,
          signal: context.signal,
        })
        buffer = result.buffer
        downloadedContentType = result.contentType
      } catch (error) {
        context.signal?.throwIfAborted()
        const notReady = docNotReadyResponse(error)
        if (notReady) return notReady
        if (isPayloadSizeLimitError(error)) {
          skipOversized(error.observedBytes ?? userFile.size)
          continue
        }
        throw error
      }

      const { url, replaceUrl } = buildUploadUrl(input, fileName)
      const contentType = downloadedContentType || userFile.type || 'application/octet-stream'
      const uploadResult = await client.upload(url, buffer, contentType)
      if (!uploadResult.ok) {
        if (uploadResult.status === 409) {
          const replaceResult = await client.upload(replaceUrl, buffer, contentType, 'replaceUrl')
          if (!replaceResult.ok) {
            errors.push({
              name: fileName,
              status: replaceResult.status,
              error: SharePointClient.errorMessage(
                replaceResult,
                `Failed to replace file: ${fileName}`
              ),
            })
            continue
          }
          uploadedFiles.push(uploadedFile(replaceResult.data as SharePointUploadedItem))
          continue
        }
        errors.push({
          name: fileName,
          status: uploadResult.status,
          error: SharePointClient.errorMessage(uploadResult, `Failed to upload file: ${fileName}`),
        })
        continue
      }
      uploadedFiles.push(uploadedFile(uploadResult.data as SharePointUploadedItem))
    }

    const output = {
      uploadedFiles,
      fileCount: uploadedFiles.length,
      skippedFiles,
      skippedCount: skippedFiles.length,
      errors,
    }
    if (uploadedFiles.length === 0) {
      return failureResponse('No files were uploaded successfully', 200, output)
    }
    return Response.json({ success: true, output })
  } catch (error) {
    context.signal?.throwIfAborted()
    logger.error('Error uploading files to SharePoint', {
      error: getErrorMessage(error),
      requestId: context.requestId,
    })
    return failureResponse(getErrorMessage(error, 'Unknown error occurred'), 500)
  }
}
