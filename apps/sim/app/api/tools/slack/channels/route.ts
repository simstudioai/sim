import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { slackChannelsSelectorContract } from '@/lib/api/contracts/selectors/slack'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackChannelsAPI')

interface SlackChannel {
  id: string
  name: string
  is_private: boolean
  is_archived: boolean
  is_member: boolean
}

/**
 * Extracts the installing user's Slack id from credentials connected after the
 * privacy fix, which `auth.ts` tags with a `usr_` marker
 * (`${teamId}-usr_${installerUserId}-${uuid}`). Legacy credentials encode the
 * bot id with no marker and return null, so the caller keeps the existing
 * `is_member` filter — no regression.
 */
const SCOPED_USER_ID_PATTERN =
  /-usr_([UW][A-Z0-9]+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseScopedSlackUserId(accountId: string): string | null {
  const match = SCOPED_USER_ID_PATTERN.exec(accountId)
  if (match) return match[1]
  // Marker present but unparseable — surface it rather than silently falling
  // back to the bot `is_member` filter and bypassing the privacy scope.
  if (accountId.includes('-usr_')) {
    logger.warn('Slack accountId carries usr_ marker but did not parse; using is_member fallback', {
      accountId,
    })
  }
  return null
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const requestId = generateRequestId()
    const parsed = await parseRequest(slackChannelsSelectorContract, request, {})
    if (!parsed.success) {
      logger.error('Missing credential in request')
      return parsed.response
    }
    const { credential, workflowId } = parsed.data.body

    let accessToken: string
    let isBotToken = false
    let scopedUserId: string | null = null

    if (credential.startsWith('xoxb-')) {
      accessToken = credential
      isBotToken = true
      logger.info('Using direct bot token for Slack API')
    } else {
      const authz = await authorizeCredentialUse(request, {
        credentialId: credential,
        workflowId: workflowId ?? undefined,
      })
      if (!authz.ok || !authz.credentialOwnerUserId) {
        return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
      }
      const resolvedToken = await refreshAccessTokenIfNeeded(
        credential,
        authz.credentialOwnerUserId,
        requestId
      )
      if (!resolvedToken) {
        logger.error('Failed to get access token', {
          credentialId: credential,
          userId: authz.credentialOwnerUserId,
        })
        return NextResponse.json(
          {
            error: 'Could not retrieve access token',
            authRequired: true,
          },
          { status: 401 }
        )
      }
      accessToken = resolvedToken
      logger.info('Using OAuth token for Slack API')

      // resolvedCredentialId is an account.id only for OAuth credentials
      // (the service_account path returns a credential.id).
      if (authz.credentialType === 'oauth' && authz.resolvedCredentialId) {
        const [accountRow] = await db
          .select({ accountId: account.accountId })
          .from(account)
          .where(eq(account.id, authz.resolvedCredentialId))
          .limit(1)
        if (accountRow) {
          scopedUserId = parseScopedSlackUserId(accountRow.accountId)
        }
      }
    }

    let data: SlackConversationsResult
    try {
      data = await fetchSlackChannels(accessToken, true)
      if (data.truncated) {
        logger.warn('conversations.list hit pagination cap; channel list may be incomplete')
      }
      logger.info('Successfully fetched channels including private channels')
    } catch (error) {
      if (isBotToken) {
        logger.warn(
          'Failed to fetch private channels with bot token, falling back to public channels only:',
          (error as Error).message
        )
        try {
          data = await fetchSlackChannels(accessToken, false)
          logger.info('Successfully fetched public channels only')
        } catch (fallbackError) {
          logger.error('Failed to fetch channels even with public-only fallback:', fallbackError)
          return NextResponse.json(
            { error: `Slack API error: ${(fallbackError as Error).message}` },
            { status: 400 }
          )
        }
      } else {
        logger.error('Slack API error with OAuth token:', error)
        return NextResponse.json(
          { error: `Slack API error: ${(error as Error).message}` },
          { status: 400 }
        )
      }
    }

    /**
     * Slack Marketplace privacy: a private channel may only be shown to a user
     * whose own Slack account is a member, even when the bot has been invited.
     * `users.conversations?user=` returns the channels the bot AND that user
     * share, giving us the allowed set. Public channels are never restricted.
     * Without a scoped user id (legacy credentials), fall back to bot membership.
     */
    let allowedPrivateChannelIds: Set<string> | null = null
    if (scopedUserId) {
      try {
        const userPrivate = await fetchUserPrivateChannels(accessToken, scopedUserId)
        allowedPrivateChannelIds = new Set(userPrivate.channels.map((c) => c.id))
        if (userPrivate.truncated) {
          logger.warn(
            'users.conversations hit pagination cap; some private channels the user belongs to may be hidden',
            { scopedUserId }
          )
        }
        logger.info('Scoped private channels to installing user membership', {
          scopedUserId,
          allowedCount: allowedPrivateChannelIds.size,
        })
      } catch (scopeError) {
        // Fail closed: if membership can't be verified, hide all private channels.
        logger.warn('Failed to scope private channels to user, hiding all private channels', {
          error: (scopeError as Error).message,
        })
        allowedPrivateChannelIds = new Set()
      }
    }

    const channels = (data.channels || [])
      .filter((channel: SlackChannel) => {
        if (channel.is_archived) return false

        if (channel.is_private) {
          if (allowedPrivateChannelIds) {
            return allowedPrivateChannelIds.has(channel.id)
          }
          return channel.is_member
        }

        return true
      })
      .filter((channel: SlackChannel) => {
        const validation = validateAlphanumericId(channel.id, 'channelId', 50)

        if (!validation.isValid) {
          logger.warn('Invalid channel ID received from Slack API', {
            channelId: channel.id,
            channelName: channel.name,
            error: validation.error,
          })
          return false
        }

        if (!/^[CDG][A-Z0-9]+$/i.test(channel.id)) {
          logger.warn('Channel ID does not match Slack format', {
            channelId: channel.id,
            channelName: channel.name,
          })
          return false
        }

        return true
      })
      .map((channel: SlackChannel) => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private,
      }))

    logger.info(`Successfully fetched ${channels.length} Slack channels`, {
      total: data.channels?.length || 0,
      private: channels.filter((c: { isPrivate: boolean }) => c.isPrivate).length,
      public: channels.filter((c: { isPrivate: boolean }) => !c.isPrivate).length,
      tokenType: isBotToken ? 'bot_token' : 'oauth',
      userScoped: !!scopedUserId,
    })
    return NextResponse.json({ channels })
  } catch (error) {
    logger.error('Error processing Slack channels request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Slack channels', details: (error as Error).message },
      { status: 500 }
    )
  }
})

const SLACK_PAGE_LIMIT = 200
const SLACK_MAX_PAGES = 10

interface SlackConversationsResult {
  channels: SlackChannel[]
  truncated: boolean
}

/**
 * Lists Slack conversations, following `response_metadata.next_cursor` so the
 * full set is returned. Bounded by `SLACK_MAX_PAGES`; sets `truncated` rather
 * than silently dropping channels when the cap is hit.
 */
async function fetchAllConversations(
  method: 'conversations.list' | 'users.conversations',
  accessToken: string,
  params: Record<string, string>
): Promise<SlackConversationsResult> {
  const channels: SlackChannel[] = []
  let cursor: string | undefined
  let truncated = false

  for (let page = 0; page < SLACK_MAX_PAGES; page++) {
    const url = new URL(`https://slack.com/api/${method}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, value)
    }
    url.searchParams.append('limit', String(SLACK_PAGE_LIMIT))
    if (cursor) {
      url.searchParams.append('cursor', cursor)
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.ok) {
      throw new Error(data.error || `Failed to fetch ${method}`)
    }

    if (Array.isArray(data.channels)) {
      channels.push(...data.channels)
    }

    cursor = data.response_metadata?.next_cursor?.trim() || undefined
    if (!cursor) {
      return { channels, truncated }
    }
    if (page === SLACK_MAX_PAGES - 1) {
      truncated = true
    }
  }

  return { channels, truncated }
}

async function fetchSlackChannels(
  accessToken: string,
  includePrivate = true
): Promise<SlackConversationsResult> {
  return fetchAllConversations('conversations.list', accessToken, {
    types: includePrivate ? 'public_channel,private_channel' : 'public_channel',
    exclude_archived: 'true',
  })
}

async function fetchUserPrivateChannels(
  accessToken: string,
  userId: string
): Promise<SlackConversationsResult> {
  return fetchAllConversations('users.conversations', accessToken, {
    user: userId,
    types: 'private_channel',
    exclude_archived: 'true',
  })
}
