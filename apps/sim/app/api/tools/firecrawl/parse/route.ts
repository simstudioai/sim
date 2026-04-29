import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('FirecrawlParseAPI')

const FirecrawlParseSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  file: RawFileInputSchema,
  options: z.record(z.unknown()).optional(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Firecrawl parse attempt`, {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = FirecrawlParseSchema.parse(body)

    const [userFile] = processFilesToUserFiles([validatedData.file], requestId, logger)
    if (!userFile) {
      return NextResponse.json({ success: false, error: 'File input is required' }, { status: 400 })
    }

    logger.info(`[${requestId}] Firecrawl parse request`, {
      fileName: userFile.name,
      size: userFile.size,
    })

    const buffer = await downloadFileFromStorage(userFile, requestId, logger)

    const formData = new FormData()
    const blob = new Blob([new Uint8Array(buffer)], {
      type: userFile.type || 'application/octet-stream',
    })
    formData.append('file', blob, userFile.name)

    if (validatedData.options && Object.keys(validatedData.options).length > 0) {
      formData.append('options', JSON.stringify(validatedData.options))
    }

    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v2/parse', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.apiKey}`,
      },
      body: formData,
    })

    if (!firecrawlResponse.ok) {
      const errorText = await firecrawlResponse.text()
      logger.error(`[${requestId}] Firecrawl API error:`, errorText)
      return NextResponse.json(
        {
          success: false,
          error: `Firecrawl API error: ${errorText || firecrawlResponse.statusText}`,
        },
        { status: firecrawlResponse.status }
      )
    }

    const firecrawlData = await firecrawlResponse.json()

    logger.info(`[${requestId}] Firecrawl parse successful`)

    return NextResponse.json({
      success: true,
      output: firecrawlData.data ?? firecrawlData,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error in Firecrawl parse:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
