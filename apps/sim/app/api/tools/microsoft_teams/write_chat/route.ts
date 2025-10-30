import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { generateRequestId } from '@/lib/utils'
import { resolveMentionsForChat, type TeamsMention } from '@/tools/microsoft_teams/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TeamsWriteChatAPI')

const TeamsWriteChatSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
  content: z.string().min(1, 'Message content is required'),
  files: z.array(z.any()).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Teams chat write attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Teams chat write request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = TeamsWriteChatSchema.parse(body)

    logger.info(`[${requestId}] Sending Teams chat message`, {
      chatId: validatedData.chatId,
      hasFiles: !!(validatedData.files && validatedData.files.length > 0),
      fileCount: validatedData.files?.length || 0,
    })

    const attachments: any[] = []
    if (validatedData.files && validatedData.files.length > 0) {
      const rawFiles = validatedData.files
      logger.info(`[${requestId}] Processing ${rawFiles.length} file(s) for upload to Teams`)

      const userFiles = processFilesToUserFiles(rawFiles, requestId, logger)

      for (const file of userFiles) {
        try {
          logger.info(`[${requestId}] Uploading file to Teams: ${file.name} (${file.size} bytes)`)

          const buffer = await downloadFileFromStorage(file, requestId, logger)

          const uploadUrl =
            'https://graph.microsoft.com/v1.0/me/drive/root:/TeamsAttachments/' +
            encodeURIComponent(file.name) +
            ':/content'

          logger.info(`[${requestId}] Uploading to Teams: ${uploadUrl}`)

          const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${validatedData.accessToken}`,
              'Content-Type': file.type || 'application/octet-stream',
            },
            body: new Uint8Array(buffer),
          })

          if (!uploadResponse.ok) {
            const errorData = await uploadResponse.json().catch(() => ({}))
            logger.error(`[${requestId}] Teams upload failed:`, errorData)
            throw new Error(
              `Failed to upload file to Teams: ${errorData.error?.message || 'Unknown error'}`
            )
          }

          const uploadedFile = await uploadResponse.json()
          logger.info(`[${requestId}] File uploaded to Teams successfully`, {
            id: uploadedFile.id,
            webUrl: uploadedFile.webUrl,
          })

          const fileDetailsUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${uploadedFile.id}?$select=id,name,webDavUrl,eTag,size`

          const fileDetailsResponse = await fetch(fileDetailsUrl, {
            headers: {
              Authorization: `Bearer ${validatedData.accessToken}`,
            },
          })

          if (!fileDetailsResponse.ok) {
            const errorData = await fileDetailsResponse.json().catch(() => ({}))
            logger.error(`[${requestId}] Failed to get file details:`, errorData)
            throw new Error(
              `Failed to get file details: ${errorData.error?.message || 'Unknown error'}`
            )
          }

          const fileDetails = await fileDetailsResponse.json()
          logger.info(`[${requestId}] Got file details`, {
            webDavUrl: fileDetails.webDavUrl,
            eTag: fileDetails.eTag,
          })

          const attachmentId = fileDetails.eTag?.match(/\{([a-f0-9-]+)\}/i)?.[1] || fileDetails.id

          attachments.push({
            id: attachmentId,
            contentType: 'reference',
            contentUrl: fileDetails.webDavUrl,
            name: file.name,
          })

          logger.info(`[${requestId}] Created attachment reference for ${file.name}`)
        } catch (error) {
          logger.error(`[${requestId}] Failed to process file ${file.name}:`, error)
          throw new Error(
            `Failed to process file "${file.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }
      }

      logger.info(
        `[${requestId}] All ${attachments.length} file(s) uploaded and attachment references created`
      )
    }

    let messageContent = validatedData.content
    let contentType: 'text' | 'html' = 'text'
    const mentionEntities: TeamsMention[] = []

    try {
      const mentionResult = await resolveMentionsForChat(
        validatedData.content,
        validatedData.chatId,
        validatedData.accessToken
      )

      if (mentionResult.hasMentions) {
        contentType = 'html'
        messageContent = mentionResult.updatedContent
        mentionEntities.push(...mentionResult.mentions)
        logger.info(`[${requestId}] Resolved ${mentionResult.mentions.length} mention(s)`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Failed to resolve mentions, continuing without them:`, error)
    }

    if (attachments.length > 0) {
      contentType = 'html'
      const attachmentTags = attachments
        .map((att) => `<attachment id="${att.id}"></attachment>`)
        .join(' ')
      messageContent = `${messageContent}<br/>${attachmentTags}`
    }

    const messageBody: {
      body: {
        contentType: 'text' | 'html'
        content: string
      }
      attachments?: any[]
      mentions?: TeamsMention[]
    } = {
      body: {
        contentType,
        content: messageContent,
      },
    }

    if (attachments.length > 0) {
      messageBody.attachments = attachments
    }

    if (mentionEntities.length > 0) {
      messageBody.mentions = mentionEntities
    }

    logger.info(`[${requestId}] Sending message to Teams chat: ${validatedData.chatId}`)

    const teamsUrl = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(validatedData.chatId)}/messages`

    const teamsResponse = await fetch(teamsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: JSON.stringify(messageBody),
    })

    if (!teamsResponse.ok) {
      const errorData = await teamsResponse.json().catch(() => ({}))
      logger.error(`[${requestId}] Microsoft Teams API error:`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: errorData.error?.message || 'Failed to send Teams message',
        },
        { status: teamsResponse.status }
      )
    }

    const responseData = await teamsResponse.json()
    logger.info(`[${requestId}] Teams message sent successfully`, {
      messageId: responseData.id,
      attachmentCount: attachments.length,
    })

    return NextResponse.json({
      success: true,
      output: {
        updatedContent: true,
        metadata: {
          messageId: responseData.id,
          chatId: responseData.chatId || validatedData.chatId,
          content: responseData.body?.content || validatedData.content,
          createdTime: responseData.createdDateTime || new Date().toISOString(),
          url: responseData.webUrl || '',
          attachmentCount: attachments.length,
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error sending Teams chat message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
