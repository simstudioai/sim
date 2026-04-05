import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Slack')

const SLACK_MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const SLACK_MAX_FILES = 15

const SLACK_REACTION_EVENTS = new Set(['reaction_added', 'reaction_removed'])

async function resolveSlackFileInfo(
  fileId: string,
  botToken: string
): Promise<{ url_private?: string; name?: string; mimetype?: string; size?: number } | null> {
  try {
    const response = await fetch(
      `https://slack.com/api/files.info?file=${encodeURIComponent(fileId)}`,
      { headers: { Authorization: `Bearer ${botToken}` } }
    )
    const data = (await response.json()) as {
      ok: boolean
      error?: string
      file?: Record<string, unknown>
    }
    if (!data.ok || !data.file) {
      logger.warn('Slack files.info failed', { fileId, error: data.error })
      return null
    }
    return {
      url_private: data.file.url_private as string | undefined,
      name: data.file.name as string | undefined,
      mimetype: data.file.mimetype as string | undefined,
      size: data.file.size as number | undefined,
    }
  } catch (error) {
    logger.error('Error calling Slack files.info', {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function downloadSlackFiles(
  rawFiles: unknown[],
  botToken: string
): Promise<Array<{ name: string; data: string; mimeType: string; size: number }>> {
  const filesToProcess = rawFiles.slice(0, SLACK_MAX_FILES)
  const downloaded: Array<{ name: string; data: string; mimeType: string; size: number }> = []

  for (const file of filesToProcess) {
    const f = file as Record<string, unknown>
    let urlPrivate = f.url_private as string | undefined
    let fileName = f.name as string | undefined
    let fileMimeType = f.mimetype as string | undefined
    let fileSize = f.size as number | undefined

    if (!urlPrivate && f.id) {
      const resolved = await resolveSlackFileInfo(f.id as string, botToken)
      if (resolved?.url_private) {
        urlPrivate = resolved.url_private
        fileName = fileName || resolved.name
        fileMimeType = fileMimeType || resolved.mimetype
        fileSize = fileSize ?? resolved.size
      }
    }

    if (!urlPrivate) {
      logger.warn('Slack file has no url_private and could not be resolved, skipping', {
        fileId: f.id,
      })
      continue
    }

    const reportedSize = Number(fileSize) || 0
    if (reportedSize > SLACK_MAX_FILE_SIZE) {
      logger.warn('Slack file exceeds size limit, skipping', {
        fileId: f.id,
        size: reportedSize,
        limit: SLACK_MAX_FILE_SIZE,
      })
      continue
    }

    try {
      const urlValidation = await validateUrlWithDNS(urlPrivate, 'url_private')
      if (!urlValidation.isValid) {
        logger.warn('Slack file url_private failed DNS validation, skipping', {
          fileId: f.id,
          error: urlValidation.error,
        })
        continue
      }

      const response = await secureFetchWithPinnedIP(urlPrivate, urlValidation.resolvedIP!, {
        headers: { Authorization: `Bearer ${botToken}` },
      })

      if (!response.ok) {
        logger.warn('Failed to download Slack file, skipping', {
          fileId: f.id,
          status: response.status,
        })
        continue
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      if (buffer.length > SLACK_MAX_FILE_SIZE) {
        logger.warn('Downloaded Slack file exceeds size limit, skipping', {
          fileId: f.id,
          actualSize: buffer.length,
          limit: SLACK_MAX_FILE_SIZE,
        })
        continue
      }

      downloaded.push({
        name: fileName || 'download',
        data: buffer.toString('base64'),
        mimeType: fileMimeType || 'application/octet-stream',
        size: buffer.length,
      })
    } catch (error) {
      logger.error('Error downloading Slack file, skipping', {
        fileId: f.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return downloaded
}

async function fetchSlackMessageText(
  channel: string,
  messageTs: string,
  botToken: string
): Promise<string> {
  try {
    const params = new URLSearchParams({ channel, timestamp: messageTs })
    const response = await fetch(`https://slack.com/api/reactions.get?${params}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    })
    const data = (await response.json()) as {
      ok: boolean
      error?: string
      type?: string
      message?: { text?: string }
    }
    if (!data.ok) {
      logger.warn('Slack reactions.get failed — message text unavailable', {
        channel,
        messageTs,
        error: data.error,
      })
      return ''
    }
    return data.message?.text ?? ''
  } catch (error) {
    logger.warn('Error fetching Slack message text', {
      channel,
      messageTs,
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}

/**
 * Handle Slack verification challenges
 */
export function handleSlackChallenge(body: unknown): NextResponse | null {
  const obj = body as Record<string, unknown>
  if (obj.type === 'url_verification' && obj.challenge) {
    return NextResponse.json({ challenge: obj.challenge })
  }

  return null
}

export const slackHandler: WebhookProviderHandler = {
  handleChallenge(body: unknown) {
    return handleSlackChallenge(body)
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    if (obj.event_id) {
      return String(obj.event_id)
    }

    const event = obj.event as Record<string, unknown> | undefined
    if (event?.ts && obj.team_id) {
      return `${obj.team_id}:${event.ts}`
    }

    return null
  },

  formatSuccessResponse() {
    return new NextResponse(null, { status: 200 })
  },

  formatQueueErrorResponse() {
    return new NextResponse(null, { status: 200 })
  },

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const botToken = providerConfig.botToken as string | undefined
    const includeFiles = Boolean(providerConfig.includeFiles)

    const rawEvent = b?.event as Record<string, unknown> | undefined

    if (!rawEvent) {
      logger.warn('Unknown Slack event type', {
        type: b?.type,
        hasEvent: false,
        bodyKeys: Object.keys(b || {}),
      })
    }

    const eventType: string = (rawEvent?.type as string) || (b?.type as string) || 'unknown'
    const isReactionEvent = SLACK_REACTION_EVENTS.has(eventType)

    const item = rawEvent?.item as Record<string, unknown> | undefined
    const channel: string = isReactionEvent
      ? (item?.channel as string) || ''
      : (rawEvent?.channel as string) || ''
    const messageTs: string = isReactionEvent
      ? (item?.ts as string) || ''
      : (rawEvent?.ts as string) || (rawEvent?.event_ts as string) || ''

    let text: string = (rawEvent?.text as string) || ''
    if (isReactionEvent && channel && messageTs && botToken) {
      text = await fetchSlackMessageText(channel, messageTs, botToken)
    }

    const rawFiles: unknown[] = (rawEvent?.files as unknown[]) ?? []
    const hasFiles = rawFiles.length > 0

    let files: Array<{ name: string; data: string; mimeType: string; size: number }> = []
    if (hasFiles && includeFiles && botToken) {
      files = await downloadSlackFiles(rawFiles, botToken)
    } else if (hasFiles && includeFiles && !botToken) {
      logger.warn('Slack message has files and includeFiles is enabled, but no bot token provided')
    }

    return {
      input: {
        event: {
          event_type: eventType,
          channel,
          channel_name: '',
          user: (rawEvent?.user as string) || '',
          user_name: '',
          text,
          timestamp: messageTs,
          thread_ts: (rawEvent?.thread_ts as string) || '',
          team_id: (b?.team_id as string) || (rawEvent?.team as string) || '',
          event_id: (b?.event_id as string) || '',
          reaction: (rawEvent?.reaction as string) || '',
          item_user: (rawEvent?.item_user as string) || '',
          hasFiles,
          files,
        },
      },
    }
  },
}
