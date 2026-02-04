import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import {
  getExtensionFromMimeType,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { normalizeExcelValues } from '@/tools/onedrive/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OneDriveUploadAPI')

const MICROSOFT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

const ExcelCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const ExcelRowSchema = z.array(ExcelCellSchema)
const ExcelValuesSchema = z.union([
  z.string(),
  z.array(ExcelRowSchema),
  z.array(z.record(ExcelCellSchema)),
])

const OneDriveUploadSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional(),
  folderId: z.string().optional().nullable(),
  mimeType: z.string().nullish(),
  values: ExcelValuesSchema.optional().nullable(),
  conflictBehavior: z.enum(['fail', 'replace', 'rename']).optional().nullable(),
})

/** Microsoft Graph DriveItem response */
interface OneDriveFileData {
  id: string
  name: string
  size: number
  webUrl: string
  createdDateTime: string
  lastModifiedDateTime: string
  file?: { mimeType: string }
  parentReference?: { id: string; path: string }
  '@microsoft.graph.downloadUrl'?: string
}

/** Microsoft Graph Excel range response */
interface ExcelRangeData {
  address?: string
  addressLocal?: string
  values?: unknown[][]
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized OneDrive upload attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated OneDrive upload request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = OneDriveUploadSchema.parse(body)
    const excelValues = normalizeExcelValues(validatedData.values)

    let fileBuffer: Buffer
    let mimeType: string

    const isExcelCreation =
      validatedData.mimeType ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && !validatedData.file

    if (isExcelCreation) {
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.aoa_to_sheet([[]])
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')

      const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      fileBuffer = Buffer.from(xlsxBuffer)
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    } else {
      const rawFile = validatedData.file

      if (!rawFile) {
        return NextResponse.json(
          {
            success: false,
            error: 'No file provided',
          },
          { status: 400 }
        )
      }

      let userFile
      try {
        userFile = processSingleFileToUserFile(rawFile, requestId, logger)
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to process file',
          },
          { status: 400 }
        )
      }

      try {
        fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
      } catch (error) {
        logger.error(`[${requestId}] Failed to download file from storage:`, error)
        return NextResponse.json(
          {
            success: false,
            error: `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
          { status: 500 }
        )
      }

      mimeType = userFile.type || 'application/octet-stream'
    }

    const maxSize = 250 * 1024 * 1024
    if (fileBuffer.length > maxSize) {
      const sizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2)
      logger.warn(`[${requestId}] File too large: ${sizeMB}MB`)
      return NextResponse.json(
        {
          success: false,
          error: `File size (${sizeMB}MB) exceeds OneDrive's limit of 250MB for simple uploads. Use chunked upload for larger files.`,
        },
        { status: 400 }
      )
    }

    let fileName = validatedData.fileName
    const hasExtension = fileName.includes('.') && fileName.lastIndexOf('.') > 0

    if (!hasExtension) {
      const extension = getExtensionFromMimeType(mimeType)
      if (extension) {
        fileName = `${fileName}.${extension}`
        logger.info(`[${requestId}] Added extension to filename: ${fileName}`)
      }
    } else if (isExcelCreation && !fileName.endsWith('.xlsx')) {
      fileName = `${fileName.replace(/\.[^.]*$/, '')}.xlsx`
    }

    let uploadUrl: string
    const folderId = validatedData.folderId?.trim()

    if (folderId && folderId !== '') {
      const folderIdValidation = validateMicrosoftGraphId(folderId, 'folderId')
      if (!folderIdValidation.isValid) {
        logger.warn(`[${requestId}] Invalid folder ID`, { error: folderIdValidation.error })
        return NextResponse.json(
          {
            success: false,
            error: folderIdValidation.error,
          },
          { status: 400 }
        )
      }
      uploadUrl = `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}:/content`
    } else {
      uploadUrl = `${MICROSOFT_GRAPH_BASE}/me/drive/root:/${encodeURIComponent(fileName)}:/content`
    }

    // Add conflict behavior if specified (defaults to replace by Microsoft Graph API)
    if (validatedData.conflictBehavior) {
      uploadUrl += `?@microsoft.graph.conflictBehavior=${validatedData.conflictBehavior}`
    }

    const uploadResponse = await secureFetchWithValidation(
      uploadUrl,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': mimeType,
        },
        body: fileBuffer,
      },
      'uploadUrl'
    )

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      return NextResponse.json(
        {
          success: false,
          error: `OneDrive upload failed: ${uploadResponse.statusText}`,
          details: errorText,
        },
        { status: uploadResponse.status }
      )
    }

    const fileData = (await uploadResponse.json()) as OneDriveFileData

    let excelWriteResult: any | undefined
    const shouldWriteExcelContent =
      isExcelCreation && Array.isArray(excelValues) && excelValues.length > 0

    if (shouldWriteExcelContent) {
      try {
        let workbookSessionId: string | undefined
        const sessionUrl = `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(
          fileData.id
        )}/workbook/createSession`
        const sessionResp = await secureFetchWithValidation(
          sessionUrl,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${validatedData.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ persistChanges: true }),
          },
          'sessionUrl'
        )

        if (sessionResp.ok) {
          const sessionData = (await sessionResp.json()) as { id?: string }
          workbookSessionId = sessionData?.id
        }

        let sheetName = 'Sheet1'
        try {
          const listUrl = `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(
            fileData.id
          )}/workbook/worksheets?$select=name&$orderby=position&$top=1`
          const listResp = await secureFetchWithValidation(
            listUrl,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${validatedData.accessToken}`,
                ...(workbookSessionId ? { 'workbook-session-id': workbookSessionId } : {}),
              },
            },
            'listUrl'
          )
          if (listResp.ok) {
            const listData = (await listResp.json()) as { value?: Array<{ name?: string }> }
            const firstSheetName = listData?.value?.[0]?.name
            if (firstSheetName) {
              sheetName = firstSheetName
            }
          } else {
            const listErr = await listResp.text()
            logger.warn(`[${requestId}] Failed to list worksheets, using default Sheet1`, {
              status: listResp.status,
              error: listErr,
            })
          }
        } catch (listError) {
          logger.warn(`[${requestId}] Error listing worksheets, using default Sheet1`, listError)
        }

        let processedValues: any = excelValues || []

        if (
          Array.isArray(processedValues) &&
          processedValues.length > 0 &&
          typeof processedValues[0] === 'object' &&
          !Array.isArray(processedValues[0])
        ) {
          const ws = XLSX.utils.json_to_sheet(processedValues)
          processedValues = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        }

        const rowsCount = processedValues.length
        const colsCount = Math.max(...processedValues.map((row: any[]) => row.length), 0)
        processedValues = processedValues.map((row: any[]) => {
          const paddedRow = [...row]
          while (paddedRow.length < colsCount) paddedRow.push('')
          return paddedRow
        })

        const indexToColLetters = (index: number): string => {
          let n = index
          let s = ''
          while (n > 0) {
            const rem = (n - 1) % 26
            s = String.fromCharCode(65 + rem) + s
            n = Math.floor((n - 1) / 26)
          }
          return s
        }

        const endColLetters = colsCount > 0 ? indexToColLetters(colsCount) : 'A'
        const endRow = rowsCount > 0 ? rowsCount : 1
        const computedRangeAddress = `A1:${endColLetters}${endRow}`

        const url = new URL(
          `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(
            fileData.id
          )}/workbook/worksheets('${encodeURIComponent(
            sheetName
          )}')/range(address='${encodeURIComponent(computedRangeAddress)}')`
        )

        const excelWriteResponse = await secureFetchWithValidation(
          url.toString(),
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${validatedData.accessToken}`,
              'Content-Type': 'application/json',
              ...(workbookSessionId ? { 'workbook-session-id': workbookSessionId } : {}),
            },
            body: JSON.stringify({ values: processedValues }),
          },
          'excelWriteUrl'
        )

        if (!excelWriteResponse || !excelWriteResponse.ok) {
          const errorText = excelWriteResponse ? await excelWriteResponse.text() : 'no response'
          logger.error(`[${requestId}] Excel content write failed`, {
            status: excelWriteResponse?.status,
            statusText: excelWriteResponse?.statusText,
            error: errorText,
          })
          excelWriteResult = {
            success: false,
            error: `Excel write failed: ${excelWriteResponse?.statusText || 'unknown'}`,
            details: errorText,
          }
        } else {
          const writeData = (await excelWriteResponse.json()) as ExcelRangeData
          const addr = writeData.address || writeData.addressLocal
          const v = writeData.values || []
          excelWriteResult = {
            success: true,
            updatedRange: addr,
            updatedRows: Array.isArray(v) ? v.length : undefined,
            updatedColumns: Array.isArray(v) && v[0] ? v[0].length : undefined,
            updatedCells: Array.isArray(v) && v[0] ? v.length * v[0].length : undefined,
          }
        }

        if (workbookSessionId) {
          try {
            const closeUrl = `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(
              fileData.id
            )}/workbook/closeSession`
            const closeResp = await secureFetchWithValidation(
              closeUrl,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${validatedData.accessToken}`,
                  'workbook-session-id': workbookSessionId,
                },
              },
              'closeSessionUrl'
            )
            if (!closeResp.ok) {
              const closeText = await closeResp.text()
              logger.warn(`[${requestId}] Failed to close Excel session`, {
                status: closeResp.status,
                error: closeText,
              })
            }
          } catch (closeErr) {
            logger.warn(`[${requestId}] Error closing Excel session`, closeErr)
          }
        }
      } catch (err) {
        logger.error(`[${requestId}] Exception during Excel content write`, err)
        excelWriteResult = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error during Excel write',
        }
      }
    }

    return NextResponse.json({
      success: true,
      output: {
        file: {
          id: fileData.id,
          name: fileData.name,
          mimeType: fileData.file?.mimeType || mimeType,
          webViewLink: fileData.webUrl,
          webContentLink: fileData['@microsoft.graph.downloadUrl'],
          size: fileData.size,
          createdTime: fileData.createdDateTime,
          modifiedTime: fileData.lastModifiedDateTime,
          parentReference: fileData.parentReference,
        },
        ...(excelWriteResult ? { excelWriteResult } : {}),
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error uploading file to OneDrive:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
