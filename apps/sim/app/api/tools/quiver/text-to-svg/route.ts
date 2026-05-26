import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { quiverTextToSvgContract } from '@/lib/api/contracts/tools/quiver'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('QuiverTextToSvgAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const userId = authResult.userId

  try {
    const parsed = await parseRequest(
      quiverTextToSvgContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    const apiReferences: Array<{ url: string } | { base64: string }> = []

    if (data.references) {
      const rawRefs = Array.isArray(data.references) ? data.references : [data.references]

      for (const ref of rawRefs) {
        if (typeof ref === 'string') {
          try {
            const parsed = JSON.parse(ref)
            if (parsed && typeof parsed === 'object') {
              const userFiles = processFilesToUserFiles([parsed as RawFileInput], requestId, logger)
              if (userFiles.length > 0) {
                const denied = await assertToolFileAccess(
                  userFiles[0].key,
                  userId,
                  requestId,
                  logger
                )
                if (denied) return denied
                const buffer = await downloadFileFromStorage(userFiles[0], requestId, logger)
                apiReferences.push({ base64: buffer.toString('base64') })
              }
            }
          } catch {
            apiReferences.push({ url: ref })
          }
        } else if (typeof ref === 'object' && ref !== null) {
          const userFiles = processFilesToUserFiles([ref as RawFileInput], requestId, logger)
          if (userFiles.length > 0) {
            const denied = await assertToolFileAccess(userFiles[0].key, userId, requestId, logger)
            if (denied) return denied
            const buffer = await downloadFileFromStorage(userFiles[0], requestId, logger)
            apiReferences.push({ base64: buffer.toString('base64') })
          }
        }
      }
    }

    const apiBody: Record<string, unknown> = {
      model: data.model,
      prompt: data.prompt,
    }

    if (data.instructions) apiBody.instructions = data.instructions
    if (apiReferences.length > 0) apiBody.references = apiReferences.slice(0, 4)
    if (data.n != null) apiBody.n = data.n
    if (data.temperature != null) apiBody.temperature = data.temperature
    if (data.top_p != null) apiBody.top_p = data.top_p
    if (data.max_output_tokens != null) apiBody.max_output_tokens = data.max_output_tokens
    if (data.presence_penalty != null) apiBody.presence_penalty = data.presence_penalty

    logger.info(`[${requestId}] Calling Quiver API with model: ${data.model}`)

    const response = await fetch('https://api.quiver.ai/v1/svgs/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.apiKey}`,
      },
      body: JSON.stringify(apiBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Quiver API error: ${response.status} - ${errorText}`)
      return NextResponse.json(
        { success: false, error: `Quiver API error: ${response.status} - ${errorText}` },
        { status: response.status }
      )
    }

    const result = await response.json()

    if (!result.data || result.data.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No SVG data returned from Quiver API' },
        { status: 500 }
      )
    }

    const files = result.data.map((entry: { svg: string }, index: number) => {
      const buffer = Buffer.from(entry.svg, 'utf-8')
      return {
        name: result.data.length > 1 ? `generated-${index + 1}.svg` : 'generated.svg',
        mimeType: 'image/svg+xml',
        data: buffer.toString('base64'),
        size: buffer.length,
      }
    })

    return NextResponse.json({
      success: true,
      output: {
        file: files[0],
        files,
        svgContent: result.data[0].svg,
        id: result.id ?? null,
        usage: result.usage
          ? {
              totalTokens: result.usage.total_tokens ?? 0,
              inputTokens: result.usage.input_tokens ?? 0,
              outputTokens: result.usage.output_tokens ?? 0,
            }
          : null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error in Quiver text-to-svg:`, error)
    const message = getErrorMessage(error, 'Unknown error')
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
