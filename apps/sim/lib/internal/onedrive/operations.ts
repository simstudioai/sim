import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import * as XLSX from 'xlsx'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  secureFetchWithValidation,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { OneDriveOperationError } from '@/lib/internal/onedrive/errors'
import type { OneDriveUploadInput } from '@/lib/internal/onedrive/schema'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import {
  getExtensionFromMimeType,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { OneDriveDownloadResponse, OneDriveToolParams } from '@/tools/onedrive/types'
import { normalizeExcelValues } from '@/tools/onedrive/utils'

const MAX_GRAPH_JSON_BYTES = 2 * 1024 * 1024
const MAX_SIMPLE_UPLOAD_BYTES = 250 * 1024 * 1024
const MAX_EXCEL_CELLS = 1_000_000
const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const logger = createLogger('OneDriveOperations')

interface GraphApiError {
  error?: { message?: string }
}

interface DriveItemMetadata {
  id?: string
  name?: string
  folder?: Record<string, unknown>
  file?: { mimeType?: string }
}

type OneDriveDownloadInput = Pick<OneDriveToolParams, 'accessToken' | 'fileName'> & {
  fileId: string
}

export interface OneDriveOperationContext {
  requestId?: string
  signal?: AbortSignal
  userId?: string
}

interface OneDriveFileData extends Record<string, unknown> {
  id: string
  name: string
  size: number
  webUrl: string
  createdDateTime: string
  lastModifiedDateTime: string
  file?: { mimeType?: string }
  parentReference?: { id: string; path: string }
  '@microsoft.graph.downloadUrl'?: string
}

interface ExcelWriteResult {
  success: boolean
  updatedRange?: string
  updatedRows?: number
  updatedColumns?: number
  updatedCells?: number
  error?: string
  details?: string
}

function oneDriveFileData(value: unknown): OneDriveFileData {
  if (!isRecordLike(value)) throw new Error('Microsoft Graph returned invalid file metadata')
  return value as OneDriveFileData
}

function fileTooLargeError(observedBytes: number): OneDriveOperationError {
  const sizeMB = (observedBytes / (1024 * 1024)).toFixed(2)
  return new OneDriveOperationError(
    `File size (${sizeMB}MB) exceeds OneDrive's limit of 250MB for simple uploads. Use chunked upload for larger files.`,
    400
  )
}

async function readGraphJson(
  response: SecureFetchResponse,
  signal?: AbortSignal
): Promise<unknown> {
  return readResponseJsonWithLimit<unknown>(response, {
    maxBytes: MAX_GRAPH_JSON_BYTES,
    label: 'Microsoft Graph response',
    signal,
  })
}

async function graphRequest(
  url: string,
  init: Omit<Parameters<typeof secureFetchWithValidation>[1], 'profile'>,
  label: string,
  signal?: AbortSignal
): Promise<SecureFetchResponse> {
  signal?.throwIfAborted()
  return secureFetchWithValidation(
    url,
    { ...init, profile: 'configuredEndpoint', maxResponseBytes: MAX_GRAPH_JSON_BYTES, signal },
    label
  )
}

function uploadedFileOutput(fileData: OneDriveFileData, mimeType: string) {
  return {
    id: fileData.id,
    name: fileData.name,
    mimeType: fileData.file?.mimeType || mimeType,
    webViewLink: fileData.webUrl,
    webContentLink: fileData['@microsoft.graph.downloadUrl'],
    size: fileData.size,
    createdTime: fileData.createdDateTime,
    modifiedTime: fileData.lastModifiedDateTime,
    parentReference: fileData.parentReference,
  }
}

function excelColumnName(index: number): string {
  let current = index
  let name = ''
  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }
  return name
}

function rectangularExcelValues(values: ReturnType<typeof normalizeExcelValues>): unknown[][] {
  if (!values?.length) return []
  let rows: unknown[][]
  if (Array.isArray(values[0])) {
    rows = values as unknown[][]
  } else {
    const worksheet = XLSX.utils.json_to_sheet(values)
    rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' })
  }
  let columns = 0
  for (const row of rows) columns = Math.max(columns, row.length)
  if (rows.length * columns > MAX_EXCEL_CELLS) {
    throw new Error(`Excel values exceed the ${MAX_EXCEL_CELLS.toLocaleString()}-cell limit`)
  }
  return rows.map((row) =>
    row.length === columns
      ? row
      : [...row, ...Array.from({ length: columns - row.length }, () => '')]
  )
}

async function writeExcelValues(
  fileId: string,
  accessToken: string,
  values: ReturnType<typeof normalizeExcelValues>,
  context: OneDriveOperationContext
): Promise<ExcelWriteResult | undefined> {
  if (!values?.length) return undefined
  let sessionId: string | undefined
  try {
    const sessionResponse = await graphRequest(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/workbook/createSession`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ persistChanges: true }),
      },
      'sessionUrl',
      context.signal
    )
    if (sessionResponse.ok) {
      const session = await readGraphJson(sessionResponse, context.signal)
      if (isRecordLike(session) && typeof session.id === 'string') sessionId = session.id
    } else {
      await sessionResponse.body?.cancel()
    }

    let sheetName = 'Sheet1'
    try {
      const listResponse = await graphRequest(
        `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/workbook/worksheets?$select=name&$orderby=position&$top=1`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(sessionId ? { 'workbook-session-id': sessionId } : {}),
          },
        },
        'listUrl',
        context.signal
      )
      if (listResponse.ok) {
        const listed = await readGraphJson(listResponse, context.signal)
        const first = isRecordLike(listed) && Array.isArray(listed.value) ? listed.value[0] : null
        if (isRecordLike(first) && typeof first.name === 'string' && first.name) {
          sheetName = first.name
        }
      } else {
        await readResponseTextWithLimit(listResponse, {
          maxBytes: MAX_GRAPH_JSON_BYTES,
          label: 'Microsoft Graph worksheet error',
          signal: context.signal,
        })
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      logger.warn('Failed to list OneDrive workbook worksheets; using Sheet1', {
        error: getErrorMessage(error),
        requestId: context.requestId,
      })
    }

    const processedValues = rectangularExcelValues(values)
    const rowCount = processedValues.length
    const columnCount = processedValues[0]?.length || 0
    const range = `A1:${columnCount > 0 ? excelColumnName(columnCount) : 'A'}${rowCount || 1}`
    const rangeUrl = new URL(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/workbook/worksheets('${encodeURIComponent(sheetName)}')/range(address='${encodeURIComponent(range)}')`
    )
    const writeResponse = await graphRequest(
      rangeUrl.toString(),
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(sessionId ? { 'workbook-session-id': sessionId } : {}),
        },
        body: JSON.stringify({ values: processedValues }),
      },
      'excelWriteUrl',
      context.signal
    )
    if (!writeResponse.ok) {
      const details = await readResponseTextWithLimit(writeResponse, {
        maxBytes: MAX_GRAPH_JSON_BYTES,
        label: 'Microsoft Graph Excel error',
        signal: context.signal,
      })
      return {
        success: false,
        error: `Excel write failed: ${writeResponse.statusText || 'unknown'}`,
        details,
      }
    }
    const written = await readGraphJson(writeResponse, context.signal)
    const data = isRecordLike(written) ? written : {}
    const returnedValues = Array.isArray(data.values) ? data.values : []
    const firstRow = Array.isArray(returnedValues[0]) ? returnedValues[0] : []
    return {
      success: true,
      updatedRange:
        typeof data.address === 'string'
          ? data.address
          : typeof data.addressLocal === 'string'
            ? data.addressLocal
            : undefined,
      updatedRows: returnedValues.length,
      updatedColumns: firstRow.length,
      updatedCells: returnedValues.length * firstRow.length,
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    return { success: false, error: getErrorMessage(error, 'Unknown error during Excel write') }
  } finally {
    if (sessionId && !context.signal?.aborted) {
      try {
        const response = await graphRequest(
          `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/workbook/closeSession`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'workbook-session-id': sessionId,
            },
          },
          'closeSessionUrl',
          context.signal
        )
        await response.body?.cancel()
      } catch (error) {
        context.signal?.throwIfAborted()
        logger.warn('Failed to close OneDrive workbook session', {
          error: getErrorMessage(error),
          requestId: context.requestId,
        })
      }
    }
  }
}

export async function uploadOneDriveFile(
  input: OneDriveUploadInput,
  context: OneDriveOperationContext
) {
  context.signal?.throwIfAborted()
  const excelValues = normalizeExcelValues(input.values)
  const isExcelCreation = input.mimeType === EXCEL_MIME_TYPE && !input.file
  const isStoredFileMode = Boolean(input.file || isExcelCreation)
  let fileBuffer: Buffer | string
  let mimeType: string
  let fileName = input.fileName

  if (!isStoredFileMode) {
    fileBuffer = input.content || ''
    mimeType = 'text/plain'
    if (!fileName.endsWith('.txt')) fileName = `${fileName.replace(/\.[^.]*$/, '')}.txt`
  } else if (isExcelCreation) {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1')
    fileBuffer = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    mimeType = EXCEL_MIME_TYPE
  } else {
    if (!input.file) throw new OneDriveOperationError('No file provided', 400)
    if (!context.userId) throw new OneDriveOperationError('Authentication required', 401)
    const requestId = context.requestId || 'onedrive-operation'
    let userFile
    try {
      userFile = processSingleFileToUserFile(input.file, requestId, logger)
    } catch (error) {
      throw new OneDriveOperationError(getErrorMessage(error, 'Failed to process file'), 400)
    }
    const denied = await assertToolFileAccess(userFile.key, context.userId, requestId, logger)
    context.signal?.throwIfAborted()
    if (denied) throw new OneDriveOperationError('File not found', denied.status)
    try {
      const downloaded = await downloadServableFileFromStorage(userFile, requestId, logger, {
        maxBytes: MAX_SIMPLE_UPLOAD_BYTES,
        signal: context.signal,
      })
      fileBuffer = downloaded.buffer
      mimeType = downloaded.contentType || userFile.type || 'application/octet-stream'
    } catch (error) {
      context.signal?.throwIfAborted()
      if (isDocNotReadyError(error)) throw new OneDriveOperationError(docNotReadyMessage(), 409)
      if (isPayloadSizeLimitError(error)) {
        throw fileTooLargeError(error.observedBytes ?? userFile.size)
      }
      throw new OneDriveOperationError(
        `Failed to download file: ${getErrorMessage(error, 'Unknown error')}`,
        500
      )
    }
  }

  if (Buffer.byteLength(fileBuffer) > MAX_SIMPLE_UPLOAD_BYTES) {
    throw fileTooLargeError(Buffer.byteLength(fileBuffer))
  }
  const hasExtension = fileName.includes('.') && fileName.lastIndexOf('.') > 0
  if (!hasExtension) {
    const extension = getExtensionFromMimeType(mimeType)
    if (extension) fileName = `${fileName}.${extension}`
  } else if (isExcelCreation && !fileName.endsWith('.xlsx')) {
    fileName = `${fileName.replace(/\.[^.]*$/, '')}.xlsx`
  }

  const folderId = input.folderId?.trim()
  if (isStoredFileMode && folderId) {
    const validation = validateMicrosoftGraphId(folderId, 'folderId')
    if (!validation.isValid) {
      throw new OneDriveOperationError(validation.error || 'Invalid folderId', 400)
    }
  }
  const encodedName = encodeURIComponent(fileName)
  let uploadUrl = folderId
    ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}:/${encodedName}:/content`
    : `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedName}:/content`
  if (isStoredFileMode && input.conflictBehavior) {
    uploadUrl += `?@microsoft.graph.conflictBehavior=${input.conflictBehavior}`
  }
  const uploadResponse = await graphRequest(
    uploadUrl,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': mimeType },
      body: fileBuffer,
    },
    'uploadUrl',
    context.signal
  )
  if (!uploadResponse.ok) {
    const details = await readResponseTextWithLimit(uploadResponse, {
      maxBytes: MAX_GRAPH_JSON_BYTES,
      label: 'OneDrive upload error',
      signal: context.signal,
    })
    throw new OneDriveOperationError(
      `OneDrive upload failed: ${uploadResponse.statusText}`,
      uploadResponse.status,
      {
        success: false,
        error: `OneDrive upload failed: ${uploadResponse.statusText}`,
        details,
      }
    )
  }
  const fileData = oneDriveFileData(await readGraphJson(uploadResponse, context.signal))
  const excelWriteResult = isExcelCreation
    ? await writeExcelValues(fileData.id, input.accessToken, excelValues, context)
    : undefined
  return {
    success: true as const,
    output: {
      file: uploadedFileOutput(fileData, mimeType),
      ...(excelWriteResult ? { excelWriteResult } : {}),
    },
  }
}

async function fetchGraph(
  url: string,
  label: string,
  accessToken: string,
  maxResponseBytes: number,
  signal?: AbortSignal
) {
  const validation = await validateUrlWithDNS(url, label, 'contentFetch')
  signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new OneDriveOperationError(validation.error || `Invalid ${label}`, 400)
  }
  return secureFetchWithPinnedIP(url, validation.resolvedIP, {
    profile: 'contentFetch',
    headers: { Authorization: `Bearer ${accessToken}` },
    maxResponseBytes,
    signal,
  })
}

async function graphError(response: SecureFetchResponse, fallback: string, signal?: AbortSignal) {
  const error: GraphApiError = await readResponseJsonWithLimit<GraphApiError>(response, {
    maxBytes: MAX_GRAPH_JSON_BYTES,
    label: 'OneDrive error response',
    signal,
  }).catch((): GraphApiError => ({}))
  return error.error?.message || fallback
}

export async function downloadOneDriveFile(
  input: OneDriveDownloadInput,
  context: OneDriveOperationContext
): Promise<OneDriveDownloadResponse> {
  context.signal?.throwIfAborted()
  const fileId = encodeURIComponent(input.fileId)
  const metadataResponse = await fetchGraph(
    `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`,
    'metadataUrl',
    input.accessToken,
    MAX_GRAPH_JSON_BYTES,
    context.signal
  )
  if (!metadataResponse.ok) {
    throw new OneDriveOperationError(
      await graphError(metadataResponse, 'Failed to get file metadata', context.signal),
      400
    )
  }
  const metadata = await readResponseJsonWithLimit<DriveItemMetadata>(metadataResponse, {
    maxBytes: MAX_GRAPH_JSON_BYTES,
    label: 'OneDrive metadata response',
    signal: context.signal,
  })
  if (metadata.folder && !metadata.file) {
    throw new OneDriveOperationError(
      `Cannot download folder "${metadata.name}". Please select a file instead.`,
      400
    )
  }

  const downloadResponse = await fetchGraph(
    `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`,
    'downloadUrl',
    input.accessToken,
    MAX_FILE_SIZE,
    context.signal
  )
  if (!downloadResponse.ok) {
    throw new OneDriveOperationError(
      await graphError(downloadResponse, 'Failed to download file', context.signal),
      400
    )
  }
  const buffer = await readResponseToBufferWithLimit(downloadResponse, {
    maxBytes: MAX_FILE_SIZE,
    label: 'OneDrive file download',
    signal: context.signal,
  })
  return {
    success: true,
    output: {
      file: {
        name: input.fileName || metadata.name || 'download',
        mimeType: metadata.file?.mimeType || 'application/octet-stream',
        data: buffer.toString('base64'),
        size: buffer.length,
      },
    },
  }
}
