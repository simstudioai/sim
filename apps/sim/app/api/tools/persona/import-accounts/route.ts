import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { personaImportAccountsContract } from '@/lib/api/contracts/tools/persona'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess, FileAccessDeniedError } from '@/app/api/files/authorization'
import {
  buildPersonaHeaders,
  extractPersonaErrorMessage,
  mapImporter,
  PERSONA_API_BASE,
} from '@/tools/persona/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PersonaImportAccountsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Persona import attempt`, {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = authResult.userId

    const parsed = await parseRequest(personaImportAccountsContract, request, {})
    if (!parsed.success) return parsed.response

    const { apiKey, file } = parsed.data.body

    const userFiles = processFilesToUserFiles([file], requestId, logger)
    if (userFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid file input: a stored CSV file is required' },
        { status: 400 }
      )
    }

    const userFile = userFiles[0]
    const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
    if (denied) return denied

    let buffer: Buffer
    try {
      const resolved = await downloadServableFileFromStorage(userFile, requestId, logger)
      buffer = resolved.buffer
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      logger.error(`[${requestId}] Failed to download Persona import file:`, error)
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Internal server error') },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Importing accounts into Persona`, {
      fileName: userFile.name,
      fileSize: buffer.length,
      userId,
    })

    const personaResponse = await fetch(`${PERSONA_API_BASE}/importer/accounts`, {
      method: 'POST',
      headers: buildPersonaHeaders(apiKey),
      body: JSON.stringify({
        data: {
          attributes: {
            file: {
              data: buffer.toString('base64'),
              filename: userFile.name,
            },
          },
        },
      }),
    })

    const personaData = await personaResponse.json().catch(() => null)

    if (!personaResponse.ok) {
      const personaError = extractPersonaErrorMessage(
        personaData,
        `Persona API error: ${personaResponse.statusText}`
      )
      logger.error(`[${requestId}] Persona import accounts failed`, {
        status: personaResponse.status,
        error: personaError,
      })
      return NextResponse.json(
        { success: false, error: personaError },
        { status: personaResponse.status }
      )
    }

    const importer = mapImporter(personaData?.data ?? {})
    if (!importer.id) {
      logger.error(`[${requestId}] Persona import accounts returned an unexpected response body`, {
        status: personaResponse.status,
      })
      return NextResponse.json(
        { success: false, error: 'Persona returned an unexpected response for the account import' },
        { status: 502 }
      )
    }

    logger.info(`[${requestId}] Persona account import created`, {
      importerId: importer.id,
    })

    return NextResponse.json({
      success: true,
      output: {
        importer,
      },
    })
  } catch (error) {
    if (error instanceof FileAccessDeniedError) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 })
    }

    logger.error(`[${requestId}] Error importing accounts into Persona:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
})
