import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  googleApiErrorMessage,
  requestGoogleDrive,
  responseErrorObject,
  responseObject,
} from '@/lib/internal/google-drive/client'
import { GoogleDriveOperationError } from '@/lib/internal/google-drive/errors'
import { resolveGoogleDriveUploadFile } from '@/lib/internal/google-drive/file-input'
import type {
  GoogleDriveDownloadInput,
  GoogleDriveExportInput,
  GoogleDriveUploadInput,
} from '@/lib/internal/google-drive/input'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import type { GoogleDriveFile, GoogleDriveRevision } from '@/tools/google_drive/types'
import {
  ALL_FILE_FIELDS,
  ALL_REVISION_FIELDS,
  DEFAULT_EXPORT_FORMATS,
  GOOGLE_WORKSPACE_MIME_TYPES,
  handleSheetsFormat,
  MAX_EXPORT_BYTES,
  SOURCE_MIME_TYPES,
  VALID_EXPORT_FORMATS,
} from '@/tools/google_drive/utils'

const logger = createLogger('GoogleDriveInternalOperation')
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

export interface GoogleDriveOperationContext {
  requestId: string
  signal?: AbortSignal
  userId?: string
}

interface GoogleDriveRevisionsResponse {
  revisions?: GoogleDriveRevision[]
}

function operationError(status: number, error: string): GoogleDriveOperationError {
  return new GoogleDriveOperationError(status, { success: false, error })
}

async function providerJsonError(
  response: Awaited<ReturnType<typeof requestGoogleDrive>>,
  fallback: string,
  status = 400,
  signal?: AbortSignal
): Promise<never> {
  const data = await responseErrorObject(response, signal)
  throw operationError(status, googleApiErrorMessage(data, fallback))
}

async function getFileMetadata(
  fileId: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<GoogleDriveFile> {
  const response = await requestGoogleDrive({
    accessToken,
    label: 'metadataUrl',
    maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
    signal,
    url: `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=${ALL_FILE_FIELDS}&supportsAllDrives=true`,
  })
  if (!response.ok) await providerJsonError(response, 'Failed to get file metadata', 400, signal)
  const data = await responseObject(response)
  return {
    ...data,
    id: typeof data.id === 'string' ? data.id : '',
    name: typeof data.name === 'string' ? data.name : '',
    mimeType: typeof data.mimeType === 'string' ? data.mimeType : '',
  } as GoogleDriveFile
}

async function updateWorkspaceFileName(
  fileId: string,
  fileName: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<void> {
  const response = await requestGoogleDrive({
    accessToken,
    body: JSON.stringify({ name: fileName }),
    headers: { 'Content-Type': 'application/json' },
    label: 'updateNameUrl',
    method: 'PATCH',
    signal,
    url: `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
  })
  await response.text()
  if (!response.ok) {
    logger.warn('Failed to update filename after conversion, but content was uploaded', {
      fileId,
      status: response.status,
    })
  }
}

async function fetchFinalFile(
  fileId: string,
  accessToken: string,
  fields: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const response = await requestGoogleDrive({
    accessToken,
    label: 'finalFileUrl',
    maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
    signal,
    url: `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${fields}`,
  })
  return responseObject(response)
}

export async function executeGoogleDriveDownload(
  input: GoogleDriveDownloadInput,
  context: GoogleDriveOperationContext
) {
  context.signal?.throwIfAborted()
  const metadata = await getFileMetadata(input.fileId, input.accessToken, context.signal)
  const fileMimeType = metadata.mimeType
  const requestedExportMimeType =
    input.mimeType && input.mimeType !== 'auto' ? input.mimeType : null
  let fileBuffer: Buffer
  let finalMimeType = fileMimeType

  if (GOOGLE_WORKSPACE_MIME_TYPES.includes(fileMimeType)) {
    const exportFormat =
      requestedExportMimeType || DEFAULT_EXPORT_FORMATS[fileMimeType] || 'text/plain'
    const validFormats = VALID_EXPORT_FORMATS[fileMimeType]
    if (validFormats && !validFormats.includes(exportFormat)) {
      throw operationError(
        400,
        `Export format "${exportFormat}" is not supported for this file type. Supported formats: ${validFormats.join(', ')}`
      )
    }
    finalMimeType = exportFormat
    const response = await requestGoogleDrive({
      accessToken: input.accessToken,
      label: 'exportUrl',
      maxResponseBytes: MAX_FILE_SIZE,
      signal: context.signal,
      url: `${DRIVE_FILES_URL}/${encodeURIComponent(input.fileId)}/export?mimeType=${encodeURIComponent(exportFormat)}&supportsAllDrives=true`,
    })
    if (!response.ok) {
      await providerJsonError(
        response,
        'Failed to export Google Workspace file',
        400,
        context.signal
      )
    }
    fileBuffer = Buffer.from(await response.arrayBuffer())
  } else {
    if (metadata.size) {
      const parsedSize = Number.parseInt(metadata.size, 10)
      if (Number.isFinite(parsedSize)) {
        assertKnownSizeWithinLimit(parsedSize, MAX_FILE_SIZE, `Google Drive file ${input.fileId}`)
      }
    }
    const response = await requestGoogleDrive({
      accessToken: input.accessToken,
      label: 'downloadUrl',
      maxResponseBytes: MAX_FILE_SIZE,
      signal: context.signal,
      url: `${DRIVE_FILES_URL}/${encodeURIComponent(input.fileId)}?alt=media&supportsAllDrives=true`,
    })
    if (!response.ok) {
      await providerJsonError(response, 'Failed to download file', 400, context.signal)
    }
    fileBuffer = Buffer.from(await response.arrayBuffer())
  }

  if (input.includeRevisions && metadata.capabilities?.canReadRevisions === true) {
    try {
      const response = await requestGoogleDrive({
        accessToken: input.accessToken,
        label: 'revisionsUrl',
        maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
        signal: context.signal,
        url: `${DRIVE_FILES_URL}/${encodeURIComponent(input.fileId)}/revisions?fields=revisions(${ALL_REVISION_FIELDS})&pageSize=100`,
      })
      if (response.ok) {
        const revisions = (await response.json()) as GoogleDriveRevisionsResponse
        metadata.revisions = revisions.revisions
      } else {
        await response.text()
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      logger.warn('Error fetching Google Drive revisions, continuing without them', {
        error: getErrorMessage(error),
        fileId: input.fileId,
      })
    }
  }

  context.signal?.throwIfAborted()
  return {
    success: true,
    output: {
      file: {
        name: input.fileName || metadata.name || 'download',
        mimeType: finalMimeType,
        data: fileBuffer.toString('base64'),
        size: fileBuffer.length,
      },
      metadata,
    },
  }
}

export async function executeGoogleDriveExport(
  input: GoogleDriveExportInput,
  context: GoogleDriveOperationContext
) {
  context.signal?.throwIfAborted()
  const metadata = await getFileMetadata(input.fileId, input.accessToken, context.signal)
  if (!GOOGLE_WORKSPACE_MIME_TYPES.includes(metadata.mimeType)) {
    throw operationError(
      400,
      `Export only supports Google Workspace files (Docs, Sheets, Slides, Drawings). This file is "${metadata.mimeType}" — use the Download operation instead.`
    )
  }
  const validFormats = VALID_EXPORT_FORMATS[metadata.mimeType]
  if (validFormats && !validFormats.includes(input.mimeType)) {
    throw operationError(
      400,
      `Export format "${input.mimeType}" is not supported for this file type. Supported formats: ${validFormats.join(', ')}`
    )
  }

  let response: Awaited<ReturnType<typeof requestGoogleDrive>>
  try {
    response = await requestGoogleDrive({
      accessToken: input.accessToken,
      label: 'exportUrl',
      maxResponseBytes: MAX_EXPORT_BYTES,
      signal: context.signal,
      url: `${DRIVE_FILES_URL}/${encodeURIComponent(input.fileId)}/export?mimeType=${encodeURIComponent(input.mimeType)}`,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (isPayloadSizeLimitError(error)) {
      const observed = error.observedBytes
      throw operationError(
        413,
        observed === undefined
          ? `Exported content exceeds the ${MAX_EXPORT_BYTES}-byte export limit.`
          : `Exported content (${observed} bytes) exceeds the ${MAX_EXPORT_BYTES}-byte export limit.`
      )
    }
    throw error
  }
  if (!response.ok) {
    await providerJsonError(response, 'Failed to export Google Workspace file', 400, context.signal)
  }

  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_EXPORT_BYTES) {
    throw operationError(
      413,
      `Exported content (${declaredSize} bytes) exceeds the ${MAX_EXPORT_BYTES}-byte export limit.`
    )
  }
  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_EXPORT_BYTES) {
    throw operationError(
      413,
      `Exported content (${arrayBuffer.byteLength} bytes) exceeds the ${MAX_EXPORT_BYTES}-byte export limit.`
    )
  }
  const fileBuffer = Buffer.from(arrayBuffer)
  return {
    success: true,
    output: {
      file: {
        name: input.fileName || metadata.name || 'export',
        mimeType: input.mimeType,
        data: fileBuffer.toString('base64'),
        size: fileBuffer.length,
      },
      exportedMimeType: input.mimeType,
    },
  }
}

function uploadMetadata(input: GoogleDriveUploadInput, requestedMimeType: string) {
  return {
    name: input.fileName,
    mimeType: requestedMimeType,
    ...(input.folderId?.trim() ? { parents: [input.folderId.trim()] } : {}),
  }
}

function prepareTextContent(input: GoogleDriveUploadInput, requestedMimeType: string): string {
  if (requestedMimeType !== 'application/vnd.google-apps.spreadsheet' || !input.content) {
    return input.content || ''
  }
  const { csv } = handleSheetsFormat(input.content as unknown)
  return csv ?? input.content
}

async function uploadTextContent(
  input: GoogleDriveUploadInput,
  context: GoogleDriveOperationContext
) {
  const requestedMimeType = input.mimeType || 'text/plain'
  const createResponse = await requestGoogleDrive({
    accessToken: input.accessToken,
    body: JSON.stringify(uploadMetadata(input, requestedMimeType)),
    headers: { 'Content-Type': 'application/json' },
    label: 'createFileUrl',
    method: 'POST',
    signal: context.signal,
    url: `${DRIVE_FILES_URL}?supportsAllDrives=true`,
  })
  const created = await responseObject(createResponse)
  if (!createResponse.ok) {
    throw operationError(
      createResponse.status,
      googleApiErrorMessage(created, 'Failed to create file in Google Drive')
    )
  }
  const fileId = typeof created.id === 'string' ? created.id : ''
  const uploadMimeType = GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)
    ? SOURCE_MIME_TYPES[requestedMimeType] || 'text/plain'
    : requestedMimeType
  const contentResponse = await requestGoogleDrive({
    accessToken: input.accessToken,
    body: prepareTextContent(input, requestedMimeType),
    headers: { 'Content-Type': uploadMimeType },
    label: 'uploadContentUrl',
    method: 'PATCH',
    signal: context.signal,
    url: `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true`,
  })
  if (!contentResponse.ok) {
    await providerJsonError(
      contentResponse,
      'Failed to upload content to file',
      contentResponse.status,
      context.signal
    )
  }
  await contentResponse.text()

  if (GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)) {
    await updateWorkspaceFileName(fileId, input.fileName, input.accessToken, context.signal)
  }
  const finalFile = await fetchFinalFile(fileId, input.accessToken, ALL_FILE_FIELDS, context.signal)
  return { success: true, output: { file: finalFile } }
}

function buildMultipartBody(
  metadata: Record<string, unknown>,
  fileBuffer: Buffer,
  mimeType: string,
  boundary: string
): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    'Content-Transfer-Encoding: base64',
    '',
    fileBuffer.toString('base64'),
    `--${boundary}--`,
  ].join('\r\n')
}

async function uploadStoredFile(
  input: GoogleDriveUploadInput & { file: NonNullable<GoogleDriveUploadInput['file']> },
  context: GoogleDriveOperationContext
) {
  const resolved = await resolveGoogleDriveUploadFile(input.file, context)
  let fileBuffer = resolved.buffer
  let uploadMimeType =
    input.mimeType || resolved.contentType || resolved.userFile.type || 'application/octet-stream'
  const requestedMimeType = uploadMimeType
  if (GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)) {
    uploadMimeType = SOURCE_MIME_TYPES[requestedMimeType] || 'text/plain'
  }
  if (requestedMimeType === 'application/vnd.google-apps.spreadsheet') {
    try {
      const { csv } = handleSheetsFormat(fileBuffer.toString('utf-8'))
      if (csv !== undefined) {
        fileBuffer = Buffer.from(csv, 'utf-8')
        uploadMimeType = 'text/csv'
      }
    } catch (error) {
      logger.warn('Could not convert Google Sheets upload to CSV, uploading as-is', {
        error: getErrorMessage(error),
      })
    }
  }

  const boundary = `boundary_${Date.now()}_${generateShortId(7)}`
  const body = buildMultipartBody(
    uploadMetadata(input, requestedMimeType),
    fileBuffer,
    uploadMimeType,
    boundary
  )
  const uploadResponse = await requestGoogleDrive({
    accessToken: input.accessToken,
    body,
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(body, 'utf-8').toString(),
    },
    label: 'uploadFileUrl',
    method: 'POST',
    signal: context.signal,
    url: `${DRIVE_UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true`,
  })
  if (!uploadResponse.ok) {
    await responseErrorObject(uploadResponse, context.signal)
    throw operationError(
      uploadResponse.status,
      `Google Drive API error: ${uploadResponse.statusText}`
    )
  }
  const uploaded = await responseObject(uploadResponse)
  const fileId = typeof uploaded.id === 'string' ? uploaded.id : ''
  if (GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)) {
    await updateWorkspaceFileName(fileId, input.fileName, input.accessToken, context.signal)
  }
  const finalFile = await fetchFinalFile(
    fileId,
    input.accessToken,
    'id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime,parents',
    context.signal
  )
  return {
    success: true,
    output: {
      file: {
        id: finalFile.id,
        name: finalFile.name,
        mimeType: finalFile.mimeType,
        webViewLink: finalFile.webViewLink,
        webContentLink: finalFile.webContentLink,
        size: finalFile.size,
        createdTime: finalFile.createdTime,
        modifiedTime: finalFile.modifiedTime,
        parents: finalFile.parents,
      },
    },
  }
}

export async function executeGoogleDriveUpload(
  input: GoogleDriveUploadInput,
  context: GoogleDriveOperationContext
) {
  context.signal?.throwIfAborted()
  return input.file
    ? uploadStoredFile({ ...input, file: input.file }, context)
    : uploadTextContent(input, context)
}
