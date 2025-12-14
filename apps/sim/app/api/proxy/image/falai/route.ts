import { Buffer } from 'node:buffer'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import type { FalAIImageResponse } from '@/tools/image/types'

const logger = createLogger('FalAIImageProxyAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // 2 minutes for image generation

interface FalAIImageRequestBody {
  provider: string
  apiKey: string
  model: string
  prompt: string
  size?: string
  numInferenceSteps?: number
  enableSafetyChecker?: boolean
  outputFormat?: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()
  logger.info(`[${requestId}] Fal.ai image generation request started`)

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: FalAIImageRequestBody = await request.json()

    const {
      apiKey,
      model: rawModel,
      prompt,
      size,
      numInferenceSteps,
      enableSafetyChecker,
      outputFormat,
    } = body

    if (!apiKey || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: apiKey and prompt' },
        { status: 400 }
      )
    }

    if (prompt.length < 1 || prompt.length > 2000) {
      return NextResponse.json(
        { error: 'Prompt must be between 1 and 2000 characters' },
        { status: 400 }
      )
    }

    const model = rawModel || 'fal-ai/flux/schnell'
    const { queueModelId, statusModelId } = normalizeModelId(model)

    logger.info(`[${requestId}] Generating image with Fal.ai model: ${queueModelId}`)

    // Build request body
    const requestBody: Record<string, unknown> = {
      prompt,
      num_images: 1,
    }

    // Map size to Fal.ai format
    if (size) {
      requestBody.image_size = size
    }

    if (numInferenceSteps !== undefined) {
      requestBody.num_inference_steps = numInferenceSteps
    }

    if (enableSafetyChecker !== undefined) {
      requestBody.enable_safety_checker = enableSafetyChecker
    }

    if (outputFormat) {
      requestBody.output_format = outputFormat
    }

    // Submit to queue
    const createResponse = await fetch(`https://queue.fal.run/${queueModelId}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!createResponse.ok) {
      const error = await createResponse.text()
      logger.error(`[${requestId}] Fal.ai API error:`, error)
      return NextResponse.json(
        { error: `Fal.ai API error: ${createResponse.status} - ${error}` },
        { status: createResponse.status }
      )
    }

    const createData = await createResponse.json()
    const requestIdFal = createData.request_id

    logger.info(`[${requestId}] Fal.ai request created: ${requestIdFal}`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), maxDuration * 1000)
    const statusUrl = `https://queue.fal.run/${statusModelId}/requests/${requestIdFal}/status/stream?logs=1`

    const statusResponse = await fetch(statusUrl, {
      headers: {
        Authorization: `Key ${apiKey}`,
      },
      signal: controller.signal,
    })

    if (!statusResponse.ok || !statusResponse.body) {
      clearTimeout(timeout)
      const error = await statusResponse.text().catch(() => 'Failed to read status stream')
      logger.error(`[${requestId}] Fal.ai status stream error:`, error)
      return NextResponse.json(
        { error: `Fal.ai status stream error: ${statusResponse.status} - ${error}` },
        { status: statusResponse.status || 500 }
      )
    }

    const reader = statusResponse.body.getReader()
    const decoder = new TextDecoder()
    let streamBuffer = ''
    let completed = false
    let failed: string | null = null

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      streamBuffer += decoder.decode(value, { stream: true })

      const lines = streamBuffer.split('\n')
      streamBuffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        if (!trimmed.startsWith('data:')) continue

        const jsonStr = trimmed.slice('data:'.length).trim()
        if (!jsonStr) continue

        try {
          const statusData = JSON.parse(jsonStr)
          const status = statusData.status as string | undefined

          if (status === 'COMPLETED') {
            completed = true
            break
          }
          if (status === 'FAILED') {
            failed = statusData.error || 'Fal.ai generation failed'
            break
          }
        } catch (error) {
          logger.error(`[${requestId}] Failed to parse status event:`, error)
        }
      }

      if (completed || failed) {
        break
      }
    }

    clearTimeout(timeout)

    if (failed) {
      logger.error(`[${requestId}] Fal.ai generation failed:`, failed)
      return NextResponse.json({ error: failed }, { status: 500 })
    }

    if (!completed) {
      return NextResponse.json(
        { error: 'Fal.ai generation did not complete before stream ended' },
        { status: 504 }
      )
    }

    // Fetch the result
    const resultResponse = await fetch(
      `https://queue.fal.run/${statusModelId}/requests/${requestIdFal}`,
      {
        headers: {
          Authorization: `Key ${apiKey}`,
        },
      }
    )

    if (!resultResponse.ok) {
      const error = await resultResponse.text()
      logger.error(`[${requestId}] Failed to fetch result:`, error)
      return NextResponse.json(
        { error: `Failed to fetch result: ${resultResponse.status} - ${error}` },
        { status: resultResponse.status }
      )
    }

    const resultData: FalAIImageResponse = await resultResponse.json()

    const imageData = resultData.images?.[0]
    if (!imageData?.url) {
      return NextResponse.json({ error: 'No image URL in response' }, { status: 500 })
    }

    // Fetch the image and convert to base64
    const imageResponse = await fetch(imageData.url)
    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: `Failed to download image: ${imageResponse.status}` },
        { status: imageResponse.status }
      )
    }

    const imageBlob = await imageResponse.blob()
    const arrayBuffer = await imageBlob.arrayBuffer()
    const imgBuffer = Buffer.from(arrayBuffer)
    const base64Image = imgBuffer.toString('base64')

    // Store the image if we have execution context
    const hasExecutionContext = body.workspaceId && body.workflowId && body.executionId

    if (hasExecutionContext) {
      const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
      const timestamp = Date.now()
      const extension = outputFormat === 'jpeg' ? 'jpg' : 'png'
      const fileName = `image-falai-${model}-${timestamp}.${extension}`
      const contentType = outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png'

      try {
        const imageFile = await uploadExecutionFile(
          {
            workspaceId: body.workspaceId!,
            workflowId: body.workflowId!,
            executionId: body.executionId!,
          },
          imgBuffer,
          fileName,
          contentType,
          authResult.userId
        )

        logger.info(`[${requestId}] Image stored successfully:`, {
          fileName,
          size: imageFile.size,
          executionId: body.executionId,
        })

        return NextResponse.json({
          imageUrl: imageFile.url,
          image: base64Image,
          model: model || 'flux-schnell',
          width: imageData.width,
          height: imageData.height,
          contentType: imageData.content_type,
        })
      } catch (error) {
        logger.error(`[${requestId}] Failed to upload image file:`, error)
        // Continue without storage, return base64
      }
    }

    return NextResponse.json({
      imageUrl: imageData.url,
      image: base64Image,
      model: model || 'flux-schnell',
      width: imageData.width,
      height: imageData.height,
      contentType: imageData.content_type,
    })
  } catch (error) {
    logger.error(`[${requestId}] Fal.ai image proxy error:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

function normalizeModelId(model: string): { queueModelId: string; statusModelId: string } {
  // For status/result requests, subpath should be stripped (per Fal queue docs)
  const parts = model.split('/').filter(Boolean)
  if (parts.length <= 2) {
    return { queueModelId: model, statusModelId: model }
  }
  const statusModelId = `${parts[0]}/${parts[1]}`
  return { queueModelId: model, statusModelId }
}

