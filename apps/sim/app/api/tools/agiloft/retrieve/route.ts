import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { agiloftLogin, agiloftLogout, buildRetrieveAttachmentUrl } from '@/tools/agiloft/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftRetrieveAPI')

const AgiloftRetrieveSchema = z.object({
  instanceUrl: z.string().min(1, 'Instance URL is required'),
  knowledgeBase: z.string().min(1, 'Knowledge base is required'),
  login: z.string().min(1, 'Login is required'),
  password: z.string().min(1, 'Password is required'),
  table: z.string().min(1, 'Table is required'),
  recordId: z.string().min(1, 'Record ID is required'),
  fieldName: z.string().min(1, 'Field name is required'),
  position: z.string().min(1, 'Position is required'),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Agiloft retrieve attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const data = AgiloftRetrieveSchema.parse(body)

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
      const url = buildRetrieveAttachmentUrl(base, data)

      logger.info(`[${requestId}] Downloading attachment from Agiloft`, {
        recordId: data.recordId,
        fieldName: data.fieldName,
        position: data.position,
      })

      const agiloftResponse = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!agiloftResponse.ok) {
        const errorText = await agiloftResponse.text()
        logger.error(
          `[${requestId}] Agiloft retrieve error: ${agiloftResponse.status} - ${errorText}`
        )
        return NextResponse.json(
          { success: false, error: `Agiloft error: ${agiloftResponse.status} - ${errorText}` },
          { status: agiloftResponse.status }
        )
      }

      const contentType = agiloftResponse.headers.get('content-type') || 'application/octet-stream'
      const contentDisposition = agiloftResponse.headers.get('content-disposition')
      let fileName = 'attachment'

      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (match?.[1]) {
          fileName = match[1].replace(/['"]/g, '')
        }
      }

      const arrayBuffer = await agiloftResponse.arrayBuffer()
      const fileBuffer = Buffer.from(arrayBuffer)

      logger.info(`[${requestId}] Attachment downloaded successfully`, {
        name: fileName,
        size: fileBuffer.length,
        mimeType: contentType,
      })

      const base64Data = fileBuffer.toString('base64')

      return NextResponse.json({
        success: true,
        output: {
          file: {
            name: fileName,
            mimeType: contentType,
            data: base64Data,
            size: fileBuffer.length,
          },
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

    logger.error(`[${requestId}] Error retrieving Agiloft attachment:`, error)

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
})
