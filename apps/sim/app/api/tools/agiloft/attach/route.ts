import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { FileInputSchema, type RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { agiloftLogin, agiloftLogout, buildAttachFileUrl } from '@/tools/agiloft/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftAttachAPI')

const AgiloftAttachSchema = z.object({
  instanceUrl: z.string().min(1, 'Instance URL is required'),
  knowledgeBase: z.string().min(1, 'Knowledge base is required'),
  login: z.string().min(1, 'Login is required'),
  password: z.string().min(1, 'Password is required'),
  table: z.string().min(1, 'Table is required'),
  recordId: z.string().min(1, 'Record ID is required'),
  fieldName: z.string().min(1, 'Field name is required'),
  file: FileInputSchema.optional().nullable(),
  fileName: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Agiloft attach attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const data = AgiloftAttachSchema.parse(body)

    if (!data.file) {
      return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
    }

    const userFiles = processFilesToUserFiles([data.file as RawFileInput], requestId, logger)

    if (userFiles.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
    }

    const userFile = userFiles[0]
    logger.info(
      `[${requestId}] Downloading file for Agiloft attach: ${userFile.name} (${userFile.size} bytes)`
    )

    const fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    const resolvedFileName = data.fileName || userFile.name || 'attachment'

    const urlValidation = await validateUrlWithDNS(data.instanceUrl, 'instanceUrl')
    if (!urlValidation.isValid) {
      logger.warn(`[${requestId}] SSRF attempt blocked for Agiloft instance URL`, {
        instanceUrl: data.instanceUrl,
      })
      return NextResponse.json(
        { success: false, error: urlValidation.error || 'Invalid instance URL' },
        { status: 400 }
      )
    }

    const token = await agiloftLogin(data)
    const base = data.instanceUrl.replace(/\/$/, '')

    try {
      const url = buildAttachFileUrl(base, data, resolvedFileName)

      logger.info(`[${requestId}] Uploading file to Agiloft: ${resolvedFileName}`)

      const agiloftResponse = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': userFile.type || 'application/octet-stream',
          Authorization: `Bearer ${token}`,
        },
        body: new Uint8Array(fileBuffer),
      })

      if (!agiloftResponse.ok) {
        const errorText = await agiloftResponse.text()
        logger.error(
          `[${requestId}] Agiloft attach error: ${agiloftResponse.status} - ${errorText}`
        )
        return NextResponse.json(
          { success: false, error: `Agiloft error: ${agiloftResponse.status} - ${errorText}` },
          { status: agiloftResponse.status }
        )
      }

      let totalAttachments = 0
      const responseText = await agiloftResponse.text()
      try {
        const responseData = JSON.parse(responseText)
        const result = responseData.result ?? responseData
        totalAttachments = typeof result === 'number' ? result : (result.count ?? result.total ?? 1)
      } catch {
        totalAttachments = Number(responseText) || 1
      }

      logger.info(
        `[${requestId}] File attached successfully. Total attachments: ${totalAttachments}`
      )

      return NextResponse.json({
        success: true,
        output: {
          recordId: data.recordId.trim(),
          fieldName: data.fieldName.trim(),
          fileName: resolvedFileName,
          totalAttachments,
        },
      })
    } finally {
      await agiloftLogout(data.instanceUrl, data.knowledgeBase, token)
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error attaching file to Agiloft:`, error)

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
