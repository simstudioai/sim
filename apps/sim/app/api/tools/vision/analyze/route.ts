import { GoogleGenAI } from '@google/genai'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { isInternalFileUrl, processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import {
  downloadFileFromStorage,
  resolveInternalFileUrl,
} from '@/lib/uploads/utils/file-utils.server'
import { convertUsageMetadata, extractTextContent } from '@/providers/google/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('VisionAnalyzeAPI')

const VisionAnalyzeSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  imageUrl: z.string().optional().nullable(),
  imageFile: RawFileInputSchema.optional().nullable(),
  model: z.string().optional().default('gpt-5.2'),
  prompt: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

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

    const userId = authResult.userId
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

      let base64 = userFile.base64
      let bufferLength = 0
      if (!base64) {
        const buffer = await downloadFileFromStorage(userFile, requestId, logger)
        base64 = buffer.toString('base64')
        bufferLength = buffer.length
      }
      const mimeType = userFile.type || 'image/jpeg'
      imageSource = `data:${mimeType};base64,${base64}`
      if (bufferLength > 0) {
        logger.info(`[${requestId}] Converted image to base64 (${bufferLength} bytes)`)
      }
    }

    let imageUrlValidation: Awaited<ReturnType<typeof validateUrlWithDNS>> | null = null
    if (imageSource && !imageSource.startsWith('data:')) {
      if (imageSource.startsWith('/') && !isInternalFileUrl(imageSource)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid file path. Only uploaded files are supported for internal paths.',
          },
          { status: 400 }
        )
      }

      if (isInternalFileUrl(imageSource)) {
        if (!userId) {
          return NextResponse.json(
            {
              success: false,
              error: 'Authentication required for internal file access',
            },
            { status: 401 }
          )
        }
        const resolution = await resolveInternalFileUrl(imageSource, userId, requestId, logger)
        if (resolution.error) {
          return NextResponse.json(
            {
              success: false,
              error: resolution.error.message,
            },
            { status: resolution.error.status }
          )
        }
        imageSource = resolution.fileUrl || imageSource
      }

      imageUrlValidation = await validateUrlWithDNS(imageSource, 'imageUrl')
      if (!imageUrlValidation.isValid) {
        return NextResponse.json(
          {
            success: false,
            error: imageUrlValidation.error,
          },
          { status: 400 }
        )
      }
    }

    const defaultPrompt = 'Please analyze this image and describe what you see in detail.'
    const prompt = validatedData.prompt || defaultPrompt

    const isClaude = validatedData.model.startsWith('claude-')
    const isGemini = validatedData.model.startsWith('gemini-')
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

    if (isGemini) {
      let base64Payload = imageSource
      if (!base64Payload.startsWith('data:')) {
        const urlValidation =
          imageUrlValidation || (await validateUrlWithDNS(base64Payload, 'imageUrl'))
        if (!urlValidation.isValid) {
          return NextResponse.json({ success: false, error: urlValidation.error }, { status: 400 })
        }

        const response = await secureFetchWithPinnedIP(base64Payload, urlValidation.resolvedIP!, {
          method: 'GET',
        })
        if (!response.ok) {
          return NextResponse.json(
            { success: false, error: 'Failed to fetch image for Gemini' },
            { status: 400 }
          )
        }
        const contentType =
          response.headers.get('content-type') || validatedData.imageFile?.type || 'image/jpeg'
        const arrayBuffer = await response.arrayBuffer()
        const base64 = Buffer.from(arrayBuffer).toString('base64')
        base64Payload = `data:${contentType};base64,${base64}`
      }
      const base64Marker = ';base64,'
      const markerIndex = base64Payload.indexOf(base64Marker)
      if (!base64Payload.startsWith('data:') || markerIndex === -1) {
        return NextResponse.json(
          { success: false, error: 'Invalid base64 image format' },
          { status: 400 }
        )
      }
      const rawMimeType = base64Payload.slice('data:'.length, markerIndex)
      const mediaType = rawMimeType.split(';')[0] || 'image/jpeg'
      const base64Data = base64Payload.slice(markerIndex + base64Marker.length)
      if (!base64Data) {
        return NextResponse.json(
          { success: false, error: 'Invalid base64 image format' },
          { status: 400 }
        )
      }

      const ai = new GoogleGenAI({ apiKey: validatedData.apiKey })
      const geminiResponse = await ai.models.generateContent({
        model: validatedData.model,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inlineData: { mimeType: mediaType, data: base64Data } }],
          },
        ],
      })

      const content = extractTextContent(geminiResponse.candidates?.[0])
      const usage = convertUsageMetadata(geminiResponse.usageMetadata)

      return NextResponse.json({
        success: true,
        output: {
          content,
          model: validatedData.model,
          tokens: usage.totalTokenCount || undefined,
        },
      })
    }

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
        max_completion_tokens: 1000,
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
