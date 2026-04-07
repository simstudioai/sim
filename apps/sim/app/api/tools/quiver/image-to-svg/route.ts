import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { FileInputSchema, type RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

const logger = createLogger('QuiverImageToSvgAPI')

const RequestSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1),
  image: z.union([FileInputSchema, z.string()]),
  temperature: z.number().min(0).max(2).optional().nullable(),
  top_p: z.number().min(0).max(1).optional().nullable(),
  max_output_tokens: z.number().int().min(1).max(131072).optional().nullable(),
  presence_penalty: z.number().min(-2).max(2).optional().nullable(),
  auto_crop: z.boolean().optional().nullable(),
  target_size: z.number().int().min(128).max(4096).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const data = RequestSchema.parse(body)

    let apiImage: { url: string } | { base64: string }

    if (typeof data.image === 'string') {
      try {
        const parsed = JSON.parse(data.image)
        if (parsed && typeof parsed === 'object') {
          const userFiles = processFilesToUserFiles([parsed as RawFileInput], requestId, logger)
          if (userFiles.length > 0) {
            const buffer = await downloadFileFromStorage(userFiles[0], requestId, logger)
            apiImage = { base64: buffer.toString('base64') }
          } else {
            return NextResponse.json(
              { success: false, error: 'Invalid file input' },
              { status: 400 }
            )
          }
        } else {
          apiImage = { url: data.image }
        }
      } catch {
        apiImage = { url: data.image }
      }
    } else if (typeof data.image === 'object' && data.image !== null) {
      const userFiles = processFilesToUserFiles([data.image as RawFileInput], requestId, logger)
      if (userFiles.length > 0) {
        const buffer = await downloadFileFromStorage(userFiles[0], requestId, logger)
        apiImage = { base64: buffer.toString('base64') }
      } else {
        return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
      }
    } else {
      return NextResponse.json({ success: false, error: 'Image is required' }, { status: 400 })
    }

    const apiBody: Record<string, unknown> = {
      model: data.model,
      image: apiImage,
    }

    if (data.temperature != null) apiBody.temperature = data.temperature
    if (data.top_p != null) apiBody.top_p = data.top_p
    if (data.max_output_tokens != null) apiBody.max_output_tokens = data.max_output_tokens
    if (data.presence_penalty != null) apiBody.presence_penalty = data.presence_penalty
    if (data.auto_crop != null) apiBody.auto_crop = data.auto_crop
    if (data.target_size != null) apiBody.target_size = data.target_size

    logger.info(`[${requestId}] Calling Quiver vectorization API with model: ${data.model}`)

    const response = await fetch('https://api.quiver.ai/v1/svgs/vectorizations', {
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

    const svgContent = result.data[0].svg
    const svgBuffer = Buffer.from(svgContent, 'utf-8')
    const file = {
      name: 'vectorized.svg',
      mimeType: 'image/svg+xml',
      data: svgBuffer.toString('base64'),
      size: svgBuffer.length,
    }

    return NextResponse.json({
      success: true,
      output: {
        file,
        files: [file],
        svgContent,
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
    logger.error(`[${requestId}] Error in Quiver image-to-svg:`, error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
