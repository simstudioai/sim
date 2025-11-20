import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('VisionAnalyzeAPI')

const VisionAnalyzeSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  imageUrl: z.string().optional().nullable(),
  imageFile: z.any().optional().nullable(),
  model: z.string().optional().default('gpt-4o'),
  prompt: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Vision analyze attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Vision analyze request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = VisionAnalyzeSchema.parse(body)

    if (!validatedData.imageUrl && !validatedData.imageFile) {
      return NextResponse.json(
        {
          success: false,
          error: 'Either imageUrl or imageFile is required',
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Analyzing image`, {
      hasFile: !!validatedData.imageFile,
      hasUrl: !!validatedData.imageUrl,
      model: validatedData.model,
    })

    let imageSource: string = validatedData.imageUrl || ''

    if (validatedData.imageFile) {
      const rawFile = validatedData.imageFile
      logger.info(`[${requestId}] Processing image file: ${rawFile.name}`)

      let userFile
      try {
        userFile = processSingleFileToUserFile(rawFile, requestId, logger)
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to process image file',
          },
          { status: 400 }
        )
      }

      const buffer = await downloadFileFromStorage(userFile, requestId, logger)

      const base64 = buffer.toString('base64')
      const mimeType = userFile.type || 'image/jpeg'
      imageSource = `data:${mimeType};base64,${base64}`
      logger.info(`[${requestId}] Converted image to base64 (${buffer.length} bytes)`)
    }

    const defaultPrompt = 'Please analyze this image and describe what you see in detail.'
    const prompt = validatedData.prompt || defaultPrompt

    const isClaude = validatedData.model.startsWith('claude-3')
    const apiUrl = isClaude
      ? 'https://api.anthropic.com/v1/messages'
      : 'https://api.openai.com/v1/chat/completions'

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (isClaude) {
      headers['x-api-key'] = validatedData.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.Authorization = `Bearer ${validatedData.apiKey}`
    }

    let requestBody: any

    if (isClaude) {
      if (imageSource.startsWith('data:')) {
        const base64Match = imageSource.match(/^data:([^;]+);base64,(.+)$/)
        if (!base64Match) {
          return NextResponse.json(
            { success: false, error: 'Invalid base64 image format' },
            { status: 400 }
          )
        }
        const [, mediaType, base64Data] = base64Match

        requestBody = {
          model: validatedData.model,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
        }
      } else {
        requestBody = {
          model: validatedData.model,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image',
                  source: { type: 'url', url: imageSource },
                },
              ],
            },
          ],
        }
      }
    } else {
      requestBody = {
        model: validatedData.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: imageSource,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      }
    }

    logger.info(`[${requestId}] Sending request to ${isClaude ? 'Anthropic' : 'OpenAI'} API`)
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error(`[${requestId}] Vision API error:`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: errorData.error?.message || errorData.message || 'Failed to analyze image',
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    const result = data.content?.[0]?.text || data.choices?.[0]?.message?.content

    logger.info(`[${requestId}] Image analyzed successfully`)

    return NextResponse.json({
      success: true,
      output: {
        content: result,
        model: data.model,
        tokens: data.content
          ? (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
          : data.usage?.total_tokens,
        usage: data.usage
          ? {
              input_tokens: data.usage.input_tokens,
              output_tokens: data.usage.output_tokens,
              total_tokens:
                data.usage.total_tokens ||
                (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
            }
          : undefined,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error analyzing image:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
