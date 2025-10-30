import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { generateRequestId } from '@/lib/utils'
import { convertMarkdownToHTML } from '@/tools/telegram/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TelegramSendDocumentAPI')

const TelegramSendDocumentSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
  files: z.array(z.any()).optional().nullable(),
  caption: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, {
      requireWorkflowId: false,
    })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Telegram send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Telegram send request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = TelegramSendDocumentSchema.parse(body)

    logger.info(`[${requestId}] Sending Telegram document`, {
      chatId: validatedData.chatId,
      hasFiles: !!(validatedData.files && validatedData.files.length > 0),
      fileCount: validatedData.files?.length || 0,
    })

    if (!validatedData.files || validatedData.files.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'At least one document file is required for sendDocument operation',
        },
        { status: 400 }
      )
    }

    const userFiles = processFilesToUserFiles(validatedData.files, requestId, logger)

    if (userFiles.length === 0) {
      logger.warn(`[${requestId}] No valid files to upload`)
      return NextResponse.json(
        {
          success: false,
          error: 'No valid files provided for upload',
        },
        { status: 400 }
      )
    }

    const maxSize = 50 * 1024 * 1024 // 50MB
    const tooLargeFiles = userFiles.filter((file) => file.size > maxSize)

    if (tooLargeFiles.length > 0) {
      const filesInfo = tooLargeFiles
        .map((f) => `${f.name} (${(f.size / (1024 * 1024)).toFixed(2)}MB)`)
        .join(', ')
      return NextResponse.json(
        {
          success: false,
          error: `The following files exceed Telegram's 50MB limit: ${filesInfo}`,
        },
        { status: 400 }
      )
    }

    const userFile = userFiles[0]
    logger.info(`[${requestId}] Uploading document: ${userFile.name}`)

    const buffer = await downloadFileFromStorage(userFile, requestId, logger)

    logger.info(`[${requestId}] Downloaded file: ${buffer.length} bytes`)

    const formData = new FormData()
    formData.append('chat_id', validatedData.chatId)

    const blob = new Blob([new Uint8Array(buffer)], { type: userFile.type })
    formData.append('document', blob, userFile.name)

    if (validatedData.caption) {
      formData.append('caption', convertMarkdownToHTML(validatedData.caption))
      formData.append('parse_mode', 'HTML')
    }

    const telegramApiUrl = `https://api.telegram.org/bot${validatedData.botToken}/sendDocument`
    logger.info(`[${requestId}] Sending request to Telegram API`)

    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      body: formData,
    })

    const data = await response.json()

    if (!data.ok) {
      logger.error(`[${requestId}] Telegram API error:`, data)
      return NextResponse.json(
        {
          success: false,
          error: data.description || 'Failed to send document to Telegram',
        },
        { status: response.status }
      )
    }

    logger.info(`[${requestId}] Document sent successfully`)

    return NextResponse.json({
      success: true,
      output: {
        message: 'Document sent successfully',
        data: data.result,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error sending Telegram document:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
