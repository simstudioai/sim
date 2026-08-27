import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { slackUsersListOrDetailContract } from '@/lib/api/contracts/selectors/slack'
import { parseRequest } from '@/lib/api/server'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authenticateSelectorRequest } from '@/lib/selectors/server/resolve-authorized-context'
import { resolveSlackSelectorCredential } from '@/lib/selectors/server/slack-credential'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackUsersAPI')

const SLACK_PAGE_LIMIT = 200
const SLACK_MAX_USER_PAGES = 10

interface SlackUser {
  id: string
  name: string
  real_name: string
  deleted: boolean
  is_bot: boolean
}

interface SlackUsersResult {
  members: SlackUser[]
  truncated: boolean
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  let providerRequestStarted = false
  let reauthorizationAvailable = false

  try {
    const requestId = generateRequestId()
    const authentication = await authenticateSelectorRequest(request)
    if (!authentication.ok) {
      return NextResponse.json({ error: authentication.error }, { status: authentication.status })
    }
    const parsed = await parseRequest(slackUsersListOrDetailContract, request, {})
    if (!parsed.success) {
      logger.error('Missing credential in request')
      return parsed.response
    }
    const { credential, workflowId, userId } = parsed.data.body

    if (userId !== undefined && userId !== null) {
      const validation = validateAlphanumericId(userId, 'userId', 100)
      if (!validation.isValid) {
        logger.warn('Invalid Slack user ID', { userId, error: validation.error })
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }
    }

    const resolvedCredential = await resolveSlackSelectorCredential(authentication.principal, {
      credential,
      workflowId,
      requestId,
    })
    if (!resolvedCredential.ok) {
      return NextResponse.json(
        {
          error: resolvedCredential.error,
          ...(resolvedCredential.authRequired ? { authRequired: true } : {}),
        },
        { status: resolvedCredential.status }
      )
    }
    const { accessToken, isBotToken, credentialAccess } = resolvedCredential
    reauthorizationAvailable = credentialAccess !== undefined
    providerRequestStarted = true

    if (userId) {
      const userData = await fetchSlackUser(accessToken, userId)
      const user = {
        id: userData.user.id,
        name: userData.user.name,
        real_name: userData.user.real_name || userData.user.name,
      }
      logger.info(`Successfully fetched Slack user: ${userId}`)
      return NextResponse.json({ user })
    }

    const data = await fetchSlackUsers(accessToken)
    if (data.truncated) {
      logger.warn('users.list hit pagination cap; user list may be incomplete')
    }

    const users = (data.members || [])
      .filter((user: SlackUser) => !user.deleted && !user.is_bot)
      .map((user: SlackUser) => ({
        id: user.id,
        name: user.name,
        real_name: user.real_name || user.name,
      }))

    logger.info(`Successfully fetched ${users.length} Slack users`, {
      total: data.members?.length || 0,
      tokenType: isBotToken ? 'bot_token' : 'oauth',
    })
    return NextResponse.json({ users })
  } catch (error) {
    if (providerRequestStarted && getErrorMessage(error) === 'invalid_auth') {
      logger.warn('Slack rejected selector authentication')
      return NextResponse.json(
        {
          error: 'Slack authentication failed',
          ...(reauthorizationAvailable ? { authRequired: true } : {}),
        },
        { status: 401 }
      )
    }
    logger.error('Error processing Slack users request')
    return NextResponse.json({ error: 'Failed to retrieve Slack users' }, { status: 500 })
  }
})

async function fetchSlackUser(accessToken: string, userId: string) {
  const url = new URL('https://slack.com/api/users.info')
  url.searchParams.append('user', userId)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  if (!data.ok) {
    throw new Error(data.error || 'Failed to fetch user')
  }

  return data
}

/**
 * Lists Slack workspace members, following `response_metadata.next_cursor` so
 * the full set is returned. Bounded by `SLACK_MAX_USER_PAGES`; sets `truncated`
 * rather than silently dropping members when the cap is hit.
 */
async function fetchSlackUsers(accessToken: string): Promise<SlackUsersResult> {
  const members: SlackUser[] = []
  let cursor: string | undefined
  let truncated = false

  for (let page = 0; page < SLACK_MAX_USER_PAGES; page++) {
    const url = new URL('https://slack.com/api/users.list')
    url.searchParams.append('limit', String(SLACK_PAGE_LIMIT))
    if (cursor) {
      url.searchParams.append('cursor', cursor)
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.ok) {
      throw new Error(data.error || 'Failed to fetch users')
    }

    if (Array.isArray(data.members)) {
      members.push(...data.members)
    }

    cursor = data.response_metadata?.next_cursor?.trim() || undefined
    if (!cursor) {
      return { members, truncated }
    }
    if (page === SLACK_MAX_USER_PAGES - 1) {
      truncated = true
    }
  }

  return { members, truncated }
}
