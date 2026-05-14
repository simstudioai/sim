import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { outlookDraftContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

export const dynamic = 'force-dynamic'

const logger = createLogger('OutlookDraftAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Outlook draft attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const userId = authResult.userId
    logger.info(`[${requestId}] Authenticated Outlook draft request via ${authResult.authType}`, {
      userId,
    })

    const parsed = await parseRequest(outlookDraftContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Creating Outlook draft`, {
      to: validatedData.to,
      subject: validatedData.subject,
      hasAttachments: !!(validatedData.attachments && validatedData.attachments.length > 0),
      attachmentCount: validatedData.attachments?.length || 0,
    })

    const toRecipients = validatedData.to.split(',').map((email) => ({
      emailAddress: { address: email.trim() },
    }))

    const ccRecipients = validatedData.cc
      ? validatedData.cc.split(',').map((email) => ({
          emailAddress: { address: email.trim() },
        }))
      : undefined

    const bccRecipients = validatedData.bcc
      ? validatedData.bcc.split(',').map((email) => ({
          emailAddress: { address: email.trim() },
        }))
      : undefined

    const message: any = {
      subject: validatedData.subject,
      body: {
        contentType: validatedData.contentType || 'text',
        content: validatedData.body,
      },
      toRecipients,
    }

    if (ccRecipients) {
      message.ccRecipients = ccRecipients
    }

    if (bccRecipients) {
      message.bccRecipients = bccRecipients
    }

    if (validatedData.attachments && validatedData.attachments.length > 0) {
      const rawAttachments = validatedData.attachments
      logger.info(`[${requestId}] Processing ${rawAttachments.length} attachment(s)`)

      const attachments = processFilesToUserFiles(rawAttachments, requestId, logger)

      if (attachments.length > 0) {
        const totalSize = attachments.reduce((sum, file) => sum + file.size, 0)
        const maxSize = 4 * 1024 * 1024 // 4MB

        if (totalSize > maxSize) {
          const sizeMB = (totalSize / (1024 * 1024)).toFixed(2)
          return NextResponse.json(
            {
              success: false,
              error: `Total attachment size (${sizeMB}MB) exceeds Outlook's limit of 4MB per request`,
            },
            { status: 400 }
          )
        }

        const accessResults = await Promise.all(
          attachments.map((file) => assertToolFileAccess(file.key, userId, requestId, logger))
        )
        const denied = accessResults.find((r) => r !== null)
        if (denied) return denied

        const buffers = await Promise.all(
          attachments.map(async (file) => {
            try {
              logger.info(
                `[${requestId}] Downloading attachment: ${file.name} (${file.size} bytes)`
              )
              return await downloadFileFromStorage(file, requestId, logger)
            } catch (error) {
              logger.error(`[${requestId}] Failed to download attachment ${file.name}:`, error)
              throw new Error(
                `Failed to download attachment "${file.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
              )
            }
          })
        )

        const attachmentObjects = attachments.map((file, i) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          contentBytes: buffers[i].toString('base64'),
        }))

        logger.info(`[${requestId}] Converted ${attachmentObjects.length} attachments to base64`)
        message.attachments = attachmentObjects
      }
    }

    const graphEndpoint = 'https://graph.microsoft.com/v1.0/me/messages'

    logger.info(`[${requestId}] Creating draft via Microsoft Graph API`)

    const graphResponse = await fetch(graphEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: JSON.stringify(message),
    })

    if (!graphResponse.ok) {
      const errorData = await graphResponse.json().catch(() => ({}))
      logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: errorData.error?.message || 'Failed to create draft',
        },
        { status: graphResponse.status }
      )
    }

    const responseData = await graphResponse.json()
    logger.info(`[${requestId}] Draft created successfully, ID: ${responseData.id}`)

    return NextResponse.json({
      success: true,
      output: {
        message: 'Draft created successfully',
        messageId: responseData.id,
        subject: responseData.subject,
        attachmentCount: message.attachments?.length || 0,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error creating Outlook draft:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
})
