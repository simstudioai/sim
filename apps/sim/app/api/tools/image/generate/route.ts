import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import type { ImageGenerationRequestBody } from '@/tools/image/types'

const logger = createLogger('ImageGenerateAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for image generation with polling

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()
  logger.info(`[${requestId}] Image generation request started`)

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: ImageGenerationRequestBody = await request.json()
    const { provider, apiKey, model, prompt, width, height, negativePrompt } = body

    if (!provider || !apiKey || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, apiKey, and prompt' },
        { status: 400 }
      )
    }

    if (provider !== 'modelslab') {
      return NextResponse.json(
        { error: `Unsupported provider: ${provider}. Currently supports: modelslab` },
        { status: 400 }
      )
    }

    if (prompt.length < 3 || prompt.length > 2000) {
      return NextResponse.json(
        { error: 'Prompt must be between 3 and 2000 characters' },
        { status: 400 }
      )
    }

    const resolvedWidth = width && width > 0 ? width : 1024
    const resolvedHeight = height && height > 0 ? height : 1024

    logger.info(`[${requestId}] Generating image with ModelsLab, model: ${model || 'flux'}`)

    const result = await generateWithModelsLab(
      apiKey,
      prompt,
      model || 'flux',
      resolvedWidth,
      resolvedHeight,
      negativePrompt,
      requestId
    )

    // Fetch the image and convert to base64 via existing image proxy
    let imageFile: string | undefined
    if (result.imageUrl) {
      try {
        const baseUrl = getInternalApiBaseUrl()
        const proxyUrl = new URL('/api/tools/image', baseUrl)
        proxyUrl.searchParams.append('url', result.imageUrl)

        const { generateInternalToken } = await import('@/lib/auth/internal')
        const token = await generateInternalToken()

        const imageResponse = await fetch(proxyUrl.toString(), {
          headers: {
            Accept: 'image/*, */*',
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        })

        if (imageResponse.ok) {
          const arrayBuffer = await imageResponse.arrayBuffer()
          if (arrayBuffer.byteLength > 0) {
            imageFile = Buffer.from(arrayBuffer).toString('base64')
          }
        }
      } catch (error) {
        logger.warn(`[${requestId}] Failed to fetch image for base64 conversion:`, error)
        // Non-fatal: still return the URL
      }
    }

    logger.info(`[${requestId}] Image generation complete`)

    return NextResponse.json({
      imageUrl: result.imageUrl,
      imageFile,
      model: model || 'flux',
      provider: 'modelslab',
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`[${requestId}] Image generation error:`, { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

async function generateWithModelsLab(
  apiKey: string,
  prompt: string,
  model: string,
  width: number,
  height: number,
  negativePrompt: string | undefined,
  requestId: string
): Promise<{ imageUrl: string }> {
  logger.info(`[${requestId}] Calling ModelsLab text2img, model: ${model}`)

  const requestBody: Record<string, unknown> = {
    key: apiKey,
    model_id: model,
    prompt,
    width,
    height,
    samples: 1,
    safety_checker: false,
    enhance_prompt: false,
  }

  if (negativePrompt) {
    requestBody.negative_prompt = negativePrompt
  }

  const createResponse = await fetch('https://modelslab.com/api/v6/images/text2img', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })

  if (!createResponse.ok) {
    const errText = await createResponse.text()
    throw new Error(`ModelsLab API error: ${createResponse.status} - ${errText}`)
  }

  const createData = await createResponse.json()
  logger.info(`[${requestId}] ModelsLab response status: ${createData.status}`)

  // Immediate success
  if (createData.status === 'success' && createData.output?.length > 0) {
    return { imageUrl: createData.output[0] }
  }

  // Async processing — poll fetch endpoint
  if (createData.status === 'processing' && createData.id) {
    const jobId = String(createData.id)
    const maxAttempts = 40 // 40 × 5s = 200s max
    let attempts = 0

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 5000))

      const fetchResponse = await fetch(
        `https://modelslab.com/api/v6/images/fetch/${jobId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: apiKey }),
        }
      )

      if (!fetchResponse.ok) {
        throw new Error(`ModelsLab fetch error: ${fetchResponse.status}`)
      }

      const fetchData = await fetchResponse.json()
      logger.info(`[${requestId}] Poll ${attempts + 1}: status=${fetchData.status}`)

      if (fetchData.status === 'success' && fetchData.output?.length > 0) {
        return { imageUrl: fetchData.output[0] }
      }

      if (fetchData.status === 'error' || fetchData.status === 'failed') {
        throw new Error(`ModelsLab image generation failed: ${fetchData.message || 'Unknown error'}`)
      }

      attempts++
    }

    throw new Error('ModelsLab image generation timed out after 200 seconds')
  }

  // Error response
  if (createData.status === 'error' || createData.error) {
    throw new Error(`ModelsLab API error: ${createData.message || createData.error || 'Unknown error'}`)
  }

  throw new Error(`ModelsLab unexpected response: ${JSON.stringify(createData)}`)
}
