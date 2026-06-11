import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { slackThreadFilesContract } from '@/lib/api/contracts/tools/communication/slack'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackThreadFilesAPI')

const MAX_FILES = 15
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const PAGE_LIMIT = 200
const MAX_PAGES = 5

interface SlackFileRef {
  id?: string
  name?: string
  mimetype?: string
  size?: number
  url_private?: string
  mode?: string
}

interface SlackThreadMessage {
  ts?: string
  files?: SlackFileRef[]
}

/**
 * Fetches every file attached anywhere in a Slack thread and returns the
 * downloaded contents in one call — replaces the manual
 * fetch-thread → extract-files → download-each loop in workflows.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack thread-files attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(slackThreadFilesContract, request, {})
    if (!parsed.success) return parsed.response
    const { accessToken, channel, threadTs, oldest } = parsed.data.body

    // Collect file references across the thread, following pagination.
    const fileRefs: SlackFileRef[] = []
    const seenFileIds = new Set<string>()
    let scannedMessages = 0
    let cursor: string | undefined
    let truncated = false

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL('https://slack.com/api/conversations.replies')
      url.searchParams.append('channel', channel.trim())
      url.searchParams.append('ts', threadTs.trim())
      url.searchParams.append('inclusive', 'true')
      url.searchParams.append('limit', String(PAGE_LIMIT))
      if (oldest) url.searchParams.append('oldest', oldest.trim())
      if (cursor) url.searchParams.append('cursor', cursor)

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = (await response.json()) as {
        ok: boolean
        error?: string
        messages?: SlackThreadMessage[]
        response_metadata?: { next_cursor?: string }
      }

      if (!data.ok) {
        const hint =
          data.error === 'missing_scope'
            ? ' (requires channels:history, groups:history, im:history, or mpim:history)'
            : ''
        return NextResponse.json(
          { success: false, error: `${data.error || 'Failed to fetch thread'}${hint}` },
          { status: 400 }
        )
      }

      const messages = data.messages ?? []
      scannedMessages += messages.length
      for (const message of messages) {
        for (const file of message.files ?? []) {
          if (file.mode === 'tombstone' || file.mode === 'hidden_by_limit') continue
          const key = file.id ?? file.url_private
          if (!key || seenFileIds.has(key)) continue
          seenFileIds.add(key)
          fileRefs.push(file)
        }
      }

      cursor = data.response_metadata?.next_cursor?.trim() || undefined
      if (!cursor) break
      if (page === MAX_PAGES - 1) truncated = true
    }

    const limitedRefs = fileRefs.slice(0, MAX_FILES)
    if (fileRefs.length > MAX_FILES) truncated = true

    const files: Array<{ name: string; mimeType: string; data: string; size: number }> = []
    for (const ref of limitedRefs) {
      if (!ref.url_private) {
        logger.warn(`[${requestId}] Thread file has no url_private, skipping`, { fileId: ref.id })
        continue
      }
      if ((ref.size ?? 0) > MAX_FILE_SIZE) {
        logger.warn(`[${requestId}] Thread file exceeds size limit, skipping`, {
          fileId: ref.id,
          size: ref.size,
        })
        continue
      }

      try {
        const urlValidation = await validateUrlWithDNS(ref.url_private, 'url_private')
        if (!urlValidation.isValid) {
          logger.warn(`[${requestId}] Thread file URL failed DNS validation, skipping`, {
            fileId: ref.id,
            error: urlValidation.error,
          })
          continue
        }

        const downloadResponse = await secureFetchWithPinnedIP(
          ref.url_private,
          urlValidation.resolvedIP!,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        if (!downloadResponse.ok) {
          logger.warn(`[${requestId}] Failed to download thread file, skipping`, {
            fileId: ref.id,
            status: downloadResponse.status,
          })
          continue
        }

        const buffer = Buffer.from(await downloadResponse.arrayBuffer())
        if (buffer.length > MAX_FILE_SIZE) {
          logger.warn(`[${requestId}] Downloaded thread file exceeds size limit, skipping`, {
            fileId: ref.id,
            actualSize: buffer.length,
          })
          continue
        }

        files.push({
          name: ref.name || 'download',
          mimeType: ref.mimetype || 'application/octet-stream',
          data: buffer.toString('base64'),
          size: buffer.length,
        })
      } catch (error) {
        logger.warn(`[${requestId}] Error downloading thread file, skipping`, {
          fileId: ref.id,
          error: getErrorMessage(error, 'Unknown error'),
        })
      }
    }

    logger.info(`[${requestId}] Thread files fetched`, {
      channel,
      threadTs,
      scannedMessages,
      found: fileRefs.length,
      downloaded: files.length,
      truncated,
    })

    return NextResponse.json({
      success: true,
      output: {
        files,
        fileCount: files.length,
        scannedMessages,
        truncated,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Slack thread files:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status: 500 }
    )
  }
})
