import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { jupyterUploadContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  buildJupyterAuthHeaders,
  encodeJupyterPath,
  normalizeJupyterServerUrl,
  UnsafeJupyterPathError,
} from '@/tools/jupyter/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JupyterUploadAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Jupyter upload attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(jupyterUploadContract, request, {})
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    let fileBuffer: Buffer
    let fileName: string

    if (data.file) {
      const userFiles = processFilesToUserFiles([data.file as RawFileInput], requestId, logger)
      if (userFiles.length === 0) {
        return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
      }
      const userFile = userFiles[0]

      const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
      if (denied) return denied

      try {
        const result = await downloadServableFileFromStorage(userFile, requestId, logger)
        fileBuffer = result.buffer
      } catch (error) {
        const notReady = docNotReadyResponse(error)
        if (notReady) return notReady
        return NextResponse.json(
          { success: false, error: getErrorMessage(error, 'Failed to download file') },
          { status: 500 }
        )
      }
      fileName = data.fileName || userFile.name
    } else if (data.fileContent) {
      fileBuffer = Buffer.from(data.fileContent, 'base64')
      fileName = data.fileName || 'file'
    } else {
      return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
    }

    const base = normalizeJupyterServerUrl(data.serverUrl)
    const destinationDirectory = (data.directory ?? '').replace(/\/+$/, '')
    const destinationPath = destinationDirectory ? `${destinationDirectory}/${fileName}` : fileName

    let encodedDestinationPath: string
    try {
      encodedDestinationPath = encodeJupyterPath(destinationPath)
    } catch (error) {
      if (error instanceof UnsafeJupyterPathError) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 })
      }
      throw error
    }
    const uploadUrl = `${base}/api/contents/${encodedDestinationPath}`

    const urlValidation = await validateUrlWithDNS(uploadUrl, 'serverUrl', { allowHttp: true })
    if (!urlValidation.isValid || !urlValidation.resolvedIP) {
      return NextResponse.json(
        { success: false, error: `Invalid Jupyter serverUrl: ${urlValidation.error}` },
        { status: 400 }
      )
    }

    const response = await secureFetchWithPinnedIP(uploadUrl, urlValidation.resolvedIP, {
      method: 'PUT',
      headers: {
        ...buildJupyterAuthHeaders(data.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'file',
        format: 'base64',
        content: fileBuffer.toString('base64'),
      }),
      allowHttp: true,
      maxRedirects: 0,
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Jupyter API error:`, { status: response.status, errorText })
      return NextResponse.json(
        { success: false, error: `Jupyter API error: ${response.status} ${errorText}` },
        { status: response.status }
      )
    }

    const uploaded = await response.json()

    logger.info(`[${requestId}] File uploaded to Jupyter: ${uploaded.path}`)

    return NextResponse.json({
      success: true,
      output: {
        name: uploaded.name ?? fileName,
        path: uploaded.path ?? destinationPath,
        size: uploaded.size ?? fileBuffer.length,
        lastModified: uploaded.last_modified ?? null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Unexpected error:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
})
