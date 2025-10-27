import { type NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { downloadFileFromStorage, processSingleFileToUserFile } from '@/lib/uploads/file-processing'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OneDriveUploadAPI')

const MICROSOFT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

const OneDriveUploadSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: z.any().optional(), // UserFile object (optional for blank Excel creation)
  folderId: z.string().optional().nullable(),
  mimeType: z.string().optional(),
  // Optional Excel write-after-create inputs
  values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

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

    logger.info(`[${requestId}] Uploading file to OneDrive`, {
      fileName: validatedData.fileName,
      folderId: validatedData.folderId || 'root',
      mimeType: validatedData.mimeType,
    })

    let fileBuffer: Buffer
    let mimeType: string

    // Check if we're creating a blank Excel file
    const isExcelCreation =
      validatedData.mimeType ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && !validatedData.file

    if (isExcelCreation) {
      // Create a blank Excel workbook
      logger.info(`[${requestId}] Creating blank Excel workbook`)

      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.aoa_to_sheet([[]])
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')

      // Generate XLSX file as buffer
      const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      fileBuffer = Buffer.from(xlsxBuffer)
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

      logger.info(`[${requestId}] Created blank Excel workbook (${fileBuffer.length} bytes)`)
    } else {
      // Handle regular file upload
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

      let fileToProcess
      if (Array.isArray(rawFile)) {
        if (rawFile.length === 0) {
          return NextResponse.json(
            {
              success: false,
              error: 'No file provided',
            },
            { status: 400 }
          )
        }
        fileToProcess = rawFile[0]
      } else {
        fileToProcess = rawFile
      }

      // Convert to UserFile format
      let userFile
      try {
        userFile = processSingleFileToUserFile(fileToProcess, requestId, logger)
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to process file',
          },
          { status: 400 }
        )
      }

      logger.info(`[${requestId}] Downloading file from storage: ${userFile.key}`)

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

    const maxSize = 250 * 1024 * 1024 // 250MB
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

    // Ensure file name has correct extension for Excel files
    let fileName = validatedData.fileName
    if (isExcelCreation && !fileName.endsWith('.xlsx')) {
      fileName = `${fileName.replace(/\.[^.]*$/, '')}.xlsx`
    }

    let uploadUrl: string
    const folderId = validatedData.folderId?.trim()

    if (folderId && folderId !== '') {
      uploadUrl = `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}:/content`
    } else {
      uploadUrl = `${MICROSOFT_GRAPH_BASE}/me/drive/root:/${encodeURIComponent(fileName)}:/content`
    }

    logger.info(`[${requestId}] Uploading to OneDrive: ${uploadUrl}`)

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': mimeType,
      },
      body: new Uint8Array(fileBuffer),
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      logger.error(`[${requestId}] OneDrive upload failed:`, {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        error: errorText,
      })
      return NextResponse.json(
        {
          success: false,
          error: `OneDrive upload failed: ${uploadResponse.statusText}`,
          details: errorText,
        },
        { status: uploadResponse.status }
      )
    }

    const fileData = await uploadResponse.json()

    logger.info(`[${requestId}] File uploaded successfully to OneDrive`, {
      fileId: fileData.id,
      fileName: fileData.name,
      size: fileData.size,
    })

    // If this is an Excel creation and values were provided, write them using the Excel API
    let excelWriteResult: any | undefined
    const shouldWriteExcelContent =
      isExcelCreation && Array.isArray(validatedData.values) && validatedData.values.length > 0

    if (shouldWriteExcelContent) {
      try {
        // Create a workbook session to ensure reliability and persistence of changes
        let workbookSessionId: string | undefined
        try {
          const sessionResp = await fetch(
            `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(fileData.id)}/workbook/createSession`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${validatedData.accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ persistChanges: true }),
            }
          )

          if (sessionResp.ok) {
            const sessionData = await sessionResp.json()
            workbookSessionId = sessionData?.id
            logger.info(`[${requestId}] Created Excel workbook session`)
          } else {
            const errText = await sessionResp.text()
            logger.warn(`[${requestId}] Failed to create Excel session, proceeding without`, {
              status: sessionResp.status,
              error: errText,
            })
          }
        } catch (sessionErr) {
          logger.warn(`[${requestId}] Error creating Excel session, proceeding without`, sessionErr)
        }

        // Determine the first worksheet name
        let sheetName = 'Sheet1'
        try {
          const listUrl = `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(
            fileData.id
          )}/workbook/worksheets?$select=name&$orderby=position&$top=1`
          const listResp = await fetch(listUrl, {
            headers: {
              Authorization: `Bearer ${validatedData.accessToken}`,
              ...(workbookSessionId ? { 'workbook-session-id': workbookSessionId } : {}),
            },
          })
          if (listResp.ok) {
            const listData = await listResp.json()
            const firstSheetName = listData?.value?.[0]?.name
            if (firstSheetName) {
              sheetName = firstSheetName
            }
            logger.info(`[${requestId}] Resolved worksheet for write`, { sheetName })
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

        // Always start at A1 on resolved first sheet
        const address = 'A1'

        // Normalize values to rectangular shape and compute dimensions
        let processedValues: any = validatedData.values || []
        if (
          Array.isArray(processedValues) &&
          processedValues.length > 0 &&
          typeof processedValues[0] === 'object' &&
          !Array.isArray(processedValues[0])
        ) {
          const allKeys = new Set<string>()
          processedValues.forEach((obj: any) => {
            if (obj && typeof obj === 'object') {
              Object.keys(obj).forEach((key) => allKeys.add(key))
            }
          })
          const headers = Array.from(allKeys)
          const rows = processedValues.map((obj: any) => {
            if (!obj || typeof obj !== 'object') {
              return Array(headers.length).fill('')
            }
            return headers.map((key) => {
              const value = obj[key]
              if (value !== null && typeof value === 'object') {
                return JSON.stringify(value)
              }
              return value === undefined ? '' : value
            })
          })
          processedValues = [headers, ...rows]
        }
        const rowsCount = Array.isArray(processedValues) ? processedValues.length : 0
        const colsCount = Array.isArray(processedValues)
          ? processedValues.reduce((max: number, row: any) => {
              const len = Array.isArray(row) ? row.length : 0
              return len > max ? len : max
            }, 0)
          : 0
        // Pad rows to equal length
        if (Array.isArray(processedValues)) {
          processedValues = processedValues.map((row: any) => {
            const r = Array.isArray(row) ? [...row] : []
            while (r.length < colsCount) r.push('')
            return r
          })
        }

        // Compute concise end range from A1 and matrix size (no network round-trip)
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

        logger.info(`[${requestId}] Computed Excel range`, {
          sheetName,
          startAddress: 'A1',
          computedRangeAddress,
          rowsCount,
          colsCount,
        })

        const url = new URL(
          `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(
            fileData.id
          )}/workbook/worksheets('${encodeURIComponent(
            sheetName
          )}')/range(address='${encodeURIComponent(computedRangeAddress)}')`
        )

        // Build matrix and computed range; omit any Google Sheets-specific options

        // processedValues computed above

        // Logging details before write
        logger.info(`[${requestId}] Writing Excel content`, {
          sheetName,
          address: computedRangeAddress,
          valuesRows: Array.isArray(processedValues) ? processedValues.length : 0,
          valuesCols:
            Array.isArray(processedValues) && processedValues[0]
              ? (processedValues[0] as any[]).length
              : 0,
        })

        const excelWriteResponse = await fetch(url.toString(), {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${validatedData.accessToken}`,
            'Content-Type': 'application/json',
            ...(workbookSessionId ? { 'workbook-session-id': workbookSessionId } : {}),
          },
          body: JSON.stringify({ values: processedValues }),
        })

        if (!excelWriteResponse || !excelWriteResponse.ok) {
          const errorText = excelWriteResponse ? await excelWriteResponse.text() : 'no response'
          logger.error(`[${requestId}] Excel content write failed`, {
            status: excelWriteResponse?.status,
            statusText: excelWriteResponse?.statusText,
            error: errorText,
          })
          // Do not fail the entire request; return upload success with write error details
          excelWriteResult = {
            success: false,
            error: `Excel write failed: ${excelWriteResponse?.statusText || 'unknown'}`,
            details: errorText,
          }
        } else {
          const writeData = await excelWriteResponse.json()
          // The Range PATCH returns a Range object; log address and values length
          const addr = writeData.address || writeData.addressLocal
          const v = writeData.values || []
          logger.info(`[${requestId}] Excel content written successfully`, {
            address: addr,
            rows: Array.isArray(v) ? v.length : 0,
            cols: Array.isArray(v) && v[0] ? v[0].length : 0,
          })
          excelWriteResult = {
            success: true,
            updatedRange: addr,
            updatedRows: Array.isArray(v) ? v.length : undefined,
            updatedColumns: Array.isArray(v) && v[0] ? v[0].length : undefined,
            updatedCells: Array.isArray(v) && v[0] ? v.length * (v[0] as any[]).length : undefined,
          }
        }

        // Attempt to close the workbook session if one was created
        if (workbookSessionId) {
          try {
            const closeResp = await fetch(
              `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(fileData.id)}/workbook/closeSession`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${validatedData.accessToken}`,
                  'workbook-session-id': workbookSessionId,
                },
              }
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
