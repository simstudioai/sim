import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { discordSendMessageContract } from '@/lib/api/contracts/tools/communication/discord'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateNumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

export const dynamic = 'force-dynamic'

const logger = createLogger('DiscordSendMessageAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Discord send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const userId = authResult.userId
    logger.info(`[${requestId}] Authenticated Discord send request via ${authResult.authType}`, {
      userId,
    })

    const parsed = await parseRequest(discordSendMessageContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    const channelIdValidation = validateNumericId(validatedData.channelId, 'channelId')
    if (!channelIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid channelId format`, {
        error: channelIdValidation.error,
      })
      return NextResponse.json(
        { success: false, error: channelIdValidation.error },
        { status: 400 }
      )
    }

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
    const filesOutput: Array<{
      name: string
      mimeType: string
      data: string
      size: number
    }> = []

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

    const accessResults = await Promise.all(
      userFiles.map((file) => assertToolFileAccess(file.key, userId, requestId, logger))
    )
    const denied = accessResults.find((r) => r !== null)
    if (denied) return denied

    const buffers = await Promise.all(
      userFiles.map(async (file, i) => {
        try {
          logger.info(`[${requestId}] Downloading file ${i}: ${file.name}`)
          return await downloadFileFromStorage(file, requestId, logger)
        } catch (error) {
          logger.error(`[${requestId}] Failed to download attachment ${file.name}:`, error)
          throw new Error(
            `Failed to download attachment "${file.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }
      })
    )

    for (let i = 0; i < userFiles.length; i++) {
      const userFile = userFiles[i]
      const buffer = buffers[i]
      logger.info(`[${requestId}] Added file ${i}: ${userFile.name} (${buffer.length} bytes)`)
      filesOutput.push({
        name: userFile.name,
        mimeType: userFile.type || 'application/octet-stream',
        data: buffer.toString('base64'),
        size: buffer.length,
      })
      const blob = new Blob([new Uint8Array(buffer)], { type: userFile.type })
      formData.append(`files[${i}]`, blob, userFile.name)
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
        files: filesOutput,
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
})
