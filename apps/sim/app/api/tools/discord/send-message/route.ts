import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('DiscordSendMessageAPI')

const DiscordSendMessageSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  channelId: z.string().min(1, 'Channel ID is required'),
  content: z.string().optional().nullable(),
  files: z.array(z.any()).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Discord send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Discord send request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = DiscordSendMessageSchema.parse(body)

    logger.info(`[${requestId}] Sending Discord message`, {
      channelId: validatedData.channelId,
      hasFiles: !!(validatedData.files && validatedData.files.length > 0),
      fileCount: validatedData.files?.length || 0,
    })

    const discordApiUrl = `https://discord.com/api/v10/channels/${validatedData.channelId}/messages`

    if (!validatedData.files || validatedData.files.length === 0) {
      logger.info(`[${requestId}] No files, using JSON POST`)

      const response = await fetch(discordApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${validatedData.botToken}`,
        },
        body: JSON.stringify({
          content: validatedData.content || '',
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        logger.error(`[${requestId}] Discord API error:`, errorData)
        return NextResponse.json(
          {
            success: false,
            error: errorData.message || 'Failed to send message',
          },
          { status: response.status }
        )
      }

      const data = await response.json()
      logger.info(`[${requestId}] Message sent successfully`)
      return NextResponse.json({
        success: true,
        output: {
          message: data.content,
          data: data,
        },
      })
    }

    logger.info(`[${requestId}] Processing ${validatedData.files.length} file(s)`)

    const userFiles = processFilesToUserFiles(validatedData.files, requestId, logger)

    if (userFiles.length === 0) {
      logger.warn(`[${requestId}] No valid files to upload, falling back to text-only`)
      const response = await fetch(discordApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${validatedData.botToken}`,
        },
        body: JSON.stringify({
          content: validatedData.content || '',
        }),
      })

      const data = await response.json()
      return NextResponse.json({
        success: true,
        output: {
          message: data.content,
          data: data,
        },
      })
    }

    const formData = new FormData()

    const payload = {
      content: validatedData.content || '',
    }
    formData.append('payload_json', JSON.stringify(payload))

    for (let i = 0; i < userFiles.length; i++) {
      const userFile = userFiles[i]
      logger.info(`[${requestId}] Downloading file ${i}: ${userFile.name}`)

      const buffer = await downloadFileFromStorage(userFile, requestId, logger)

      const blob = new Blob([new Uint8Array(buffer)], { type: userFile.type })
      formData.append(`files[${i}]`, blob, userFile.name)
      logger.info(`[${requestId}] Added file ${i}: ${userFile.name} (${buffer.length} bytes)`)
    }

    logger.info(`[${requestId}] Sending multipart request with ${userFiles.length} file(s)`)
    const response = await fetch(discordApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${validatedData.botToken}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error(`[${requestId}] Discord API error:`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: errorData.message || 'Failed to send message with files',
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    logger.info(`[${requestId}] Message with files sent successfully`)

    return NextResponse.json({
      success: true,
      output: {
        message: data.content,
        data: data,
        fileCount: userFiles.length,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error sending Discord message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
