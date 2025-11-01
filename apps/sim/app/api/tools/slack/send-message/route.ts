import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackSendMessageAPI')

const SlackSendMessageSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  channel: z.string().min(1, 'Channel is required'),
  text: z.string().min(1, 'Message text is required'),
  thread_ts: z.string().optional().nullable(),
  files: z.array(z.any()).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Slack send request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = SlackSendMessageSchema.parse(body)

    logger.info(`[${requestId}] Sending Slack message`, {
      channel: validatedData.channel,
      hasFiles: !!(validatedData.files && validatedData.files.length > 0),
      fileCount: validatedData.files?.length || 0,
    })

    if (!validatedData.files || validatedData.files.length === 0) {
      logger.info(`[${requestId}] No files, using chat.postMessage`)

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validatedData.accessToken}`,
        },
        body: JSON.stringify({
          channel: validatedData.channel,
          text: validatedData.text,
          ...(validatedData.thread_ts && { thread_ts: validatedData.thread_ts }),
        }),
      })

      const data = await response.json()

      if (!data.ok) {
        logger.error(`[${requestId}] Slack API error:`, data.error)
        return NextResponse.json(
          {
            success: false,
            error: data.error || 'Failed to send message',
          },
          { status: 400 }
        )
      }

      logger.info(`[${requestId}] Message sent successfully`)
      return NextResponse.json({
        success: true,
        output: {
          ts: data.ts,
          channel: data.channel,
        },
      })
    }

    logger.info(`[${requestId}] Processing ${validatedData.files.length} file(s)`)

    const userFiles = processFilesToUserFiles(validatedData.files, requestId, logger)

    if (userFiles.length === 0) {
      logger.warn(`[${requestId}] No valid files to upload`)
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validatedData.accessToken}`,
        },
        body: JSON.stringify({
          channel: validatedData.channel,
          text: validatedData.text,
          ...(validatedData.thread_ts && { thread_ts: validatedData.thread_ts }),
        }),
      })

      const data = await response.json()
      return NextResponse.json({
        success: true,
        output: {
          ts: data.ts,
          channel: data.channel,
        },
      })
    }

    const uploadedFileIds: string[] = []

    for (const userFile of userFiles) {
      logger.info(`[${requestId}] Uploading file: ${userFile.name}`)

      const buffer = await downloadFileFromStorage(userFile, requestId, logger)

      const getUrlResponse = await fetch('https://slack.com/api/files.getUploadURLExternal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${validatedData.accessToken}`,
        },
        body: new URLSearchParams({
          filename: userFile.name,
          length: buffer.length.toString(),
        }),
      })

      const urlData = await getUrlResponse.json()

      if (!urlData.ok) {
        logger.error(`[${requestId}] Failed to get upload URL:`, urlData.error)
        continue
      }

      logger.info(`[${requestId}] Got upload URL for ${userFile.name}, file_id: ${urlData.file_id}`)

      const uploadResponse = await fetch(urlData.upload_url, {
        method: 'POST',
        body: new Uint8Array(buffer),
      })

      if (!uploadResponse.ok) {
        logger.error(`[${requestId}] Failed to upload file data: ${uploadResponse.status}`)
        continue
      }

      logger.info(`[${requestId}] File data uploaded successfully`)
      uploadedFileIds.push(urlData.file_id)
    }

    if (uploadedFileIds.length === 0) {
      logger.warn(`[${requestId}] No files uploaded successfully, sending text-only message`)
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validatedData.accessToken}`,
        },
        body: JSON.stringify({
          channel: validatedData.channel,
          text: validatedData.text,
          ...(validatedData.thread_ts && { thread_ts: validatedData.thread_ts }),
        }),
      })

      const data = await response.json()
      return NextResponse.json({
        success: true,
        output: {
          ts: data.ts,
          channel: data.channel,
        },
      })
    }

    const completeResponse = await fetch('https://slack.com/api/files.completeUploadExternal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: JSON.stringify({
        files: uploadedFileIds.map((id) => ({ id })),
        channel_id: validatedData.channel,
        initial_comment: validatedData.text,
      }),
    })

    const completeData = await completeResponse.json()

    if (!completeData.ok) {
      logger.error(`[${requestId}] Failed to complete upload:`, completeData.error)
      return NextResponse.json(
        {
          success: false,
          error: completeData.error || 'Failed to complete file upload',
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Files uploaded and shared successfully`)

    return NextResponse.json({
      success: true,
      output: {
        ts: completeData.files?.[0]?.created || Date.now() / 1000,
        channel: validatedData.channel,
        fileCount: uploadedFileIds.length,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error sending Slack message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
