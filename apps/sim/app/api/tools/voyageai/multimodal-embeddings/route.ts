import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('VoyageAIMultimodalAPI')

const MultimodalEmbeddingsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  input: z.string().optional().nullable(),
  imageFiles: z.union([RawFileInputSchema, RawFileInputArraySchema]).optional().nullable(),
  imageUrls: z.string().optional().nullable(),
  videoFile: RawFileInputSchema.optional().nullable(),
  videoUrl: z.string().optional().nullable(),
  model: z.string().optional().default('voyage-multimodal-3.5'),
  inputType: z.enum(['query', 'document']).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized multimodal embeddings attempt`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const params = MultimodalEmbeddingsSchema.parse(body)

    const content: Array<Record<string, string>> = []

    // Add text content
    if (params.input?.trim()) {
      content.push({ type: 'text', text: params.input })
    }

    // Process image files → base64
    if (params.imageFiles) {
      const files = Array.isArray(params.imageFiles) ? params.imageFiles : [params.imageFiles]
      for (const rawFile of files) {
        try {
          const userFile = processSingleFileToUserFile(rawFile, requestId, logger)
          let base64 = userFile.base64
          if (!base64) {
            const buffer = await downloadFileFromStorage(userFile, requestId, logger)
            base64 = buffer.toString('base64')
            logger.info(`[${requestId}] Converted image to base64 (${buffer.length} bytes)`)
          }
          const mimeType = userFile.type || 'image/jpeg'
          content.push({
            type: 'image_base64',
            image_base64: `data:${mimeType};base64,${base64}`,
          })
        } catch (error) {
          logger.error(`[${requestId}] Failed to process image file:`, error)
          return NextResponse.json(
            { success: false, error: `Failed to process image file: ${error instanceof Error ? error.message : 'Unknown error'}` },
            { status: 400 }
          )
        }
      }
    }

    // Process image URLs
    if (params.imageUrls?.trim()) {
      let urls: string[]
      try {
        urls = JSON.parse(params.imageUrls)
      } catch {
        urls = params.imageUrls
          .split(/[,\n]/)
          .map((u) => u.trim())
          .filter(Boolean)
      }

      for (const url of urls) {
        const validation = await validateUrlWithDNS(url, 'imageUrl')
        if (!validation.isValid) {
          return NextResponse.json(
            { success: false, error: `Invalid image URL: ${validation.error}` },
            { status: 400 }
          )
        }
        content.push({ type: 'image_url', image_url: url })
      }
    }

    // Process video file → base64
    if (params.videoFile) {
      try {
        const userFile = processSingleFileToUserFile(params.videoFile, requestId, logger)
        let base64 = userFile.base64
        if (!base64) {
          const buffer = await downloadFileFromStorage(userFile, requestId, logger)
          base64 = buffer.toString('base64')
          logger.info(`[${requestId}] Converted video to base64 (${buffer.length} bytes)`)
        }
        const mimeType = userFile.type || 'video/mp4'
        content.push({
          type: 'video_base64',
          video_base64: `data:${mimeType};base64,${base64}`,
        })
      } catch (error) {
        logger.error(`[${requestId}] Failed to process video file:`, error)
        return NextResponse.json(
          { success: false, error: `Failed to process video file: ${error instanceof Error ? error.message : 'Unknown error'}` },
          { status: 400 }
        )
      }
    }

    // Process video URL
    if (params.videoUrl?.trim()) {
      const validation = await validateUrlWithDNS(params.videoUrl, 'videoUrl')
      if (!validation.isValid) {
        return NextResponse.json(
          { success: false, error: `Invalid video URL: ${validation.error}` },
          { status: 400 }
        )
      }
      content.push({ type: 'video_url', video_url: params.videoUrl })
    }

    if (content.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one input (text, image, or video) is required' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Calling VoyageAI multimodal embeddings`, {
      contentTypes: content.map((c) => c.type),
      model: params.model,
    })

    // Build VoyageAI request
    const voyageBody: Record<string, unknown> = {
      inputs: [{ content }],
      model: params.model,
    }
    if (params.inputType) {
      voyageBody.input_type = params.inputType
    }

    const voyageResponse = await fetch('https://api.voyageai.com/v1/multimodalembeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(voyageBody),
    })

    if (!voyageResponse.ok) {
      const errorText = await voyageResponse.text()
      logger.error(`[${requestId}] VoyageAI API error: ${voyageResponse.status}`, { errorText })
      return NextResponse.json(
        { success: false, error: `VoyageAI API error: ${voyageResponse.status} - ${errorText}` },
        { status: voyageResponse.status }
      )
    }

    const data = await voyageResponse.json()

    logger.info(`[${requestId}] Multimodal embeddings generated successfully`, {
      embeddingsCount: data.data?.length,
      totalTokens: data.usage?.total_tokens,
    })

    return NextResponse.json({
      success: true,
      output: {
        embeddings: data.data.map((item: { embedding: number[] }) => item.embedding),
        model: data.model,
        usage: {
          text_tokens: data.usage?.text_tokens,
          image_pixels: data.usage?.image_pixels,
          video_pixels: data.usage?.video_pixels,
          total_tokens: data.usage?.total_tokens,
        },
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Multimodal embeddings failed:`, error)
    return NextResponse.json(
      { success: false, error: `Multimodal embeddings failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
