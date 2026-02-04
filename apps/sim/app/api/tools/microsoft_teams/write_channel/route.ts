import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { uploadFilesForTeamsMessage } from '@/tools/microsoft_teams/server-utils'
import type { GraphApiErrorResponse, GraphChatMessage } from '@/tools/microsoft_teams/types'
import { resolveMentionsForChannel, type TeamsMention } from '@/tools/microsoft_teams/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TeamsWriteChannelAPI')

const TeamsWriteChannelSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  teamId: z.string().min(1, 'Team ID is required'),
  channelId: z.string().min(1, 'Channel ID is required'),
  content: z.string().min(1, 'Message content is required'),
  files: RawFileInputArraySchema.optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Teams channel write attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Teams channel write request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = TeamsWriteChannelSchema.parse(body)

    logger.info(`[${requestId}] Sending Teams channel message`, {
      teamId: validatedData.teamId,
      channelId: validatedData.channelId,
      hasFiles: !!(validatedData.files && validatedData.files.length > 0),
      fileCount: validatedData.files?.length || 0,
    })

    const { attachments, filesOutput } = await uploadFilesForTeamsMessage({
      rawFiles: validatedData.files || [],
      accessToken: validatedData.accessToken,
      requestId,
      logger,
    })

    let messageContent = validatedData.content
    let contentType: 'text' | 'html' = 'text'
    const mentionEntities: TeamsMention[] = []

    try {
      const mentionResult = await resolveMentionsForChannel(
        validatedData.content,
        validatedData.teamId,
        validatedData.channelId,
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

    logger.info(`[${requestId}] Sending message to Teams channel: ${validatedData.channelId}`)

    const teamsUrl = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(validatedData.teamId)}/channels/${encodeURIComponent(validatedData.channelId)}/messages`

    const teamsResponse = await secureFetchWithValidation(
      teamsUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validatedData.accessToken}`,
        },
        body: JSON.stringify(messageBody),
      },
      'teamsUrl'
    )

    if (!teamsResponse.ok) {
      const errorData = (await teamsResponse.json().catch(() => ({}))) as GraphApiErrorResponse
      logger.error(`[${requestId}] Microsoft Teams API error:`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: errorData.error?.message || 'Failed to send Teams channel message',
        },
        { status: teamsResponse.status }
      )
    }

    const responseData = (await teamsResponse.json()) as GraphChatMessage
    logger.info(`[${requestId}] Teams channel message sent successfully`, {
      messageId: responseData.id,
      attachmentCount: attachments.length,
    })

    return NextResponse.json({
      success: true,
      output: {
        updatedContent: true,
        metadata: {
          messageId: responseData.id,
          teamId: responseData.channelIdentity?.teamId || validatedData.teamId,
          channelId: responseData.channelIdentity?.channelId || validatedData.channelId,
          content: responseData.body?.content || validatedData.content,
          createdTime: responseData.createdDateTime || new Date().toISOString(),
          url: responseData.webUrl || '',
          attachmentCount: attachments.length,
        },
        files: filesOutput,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error sending Teams channel message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
