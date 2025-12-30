import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackUsersAPI')

interface SlackUser {
  id: string
  name: string
  real_name: string
  deleted: boolean
  is_bot: boolean
}

export async function POST(request: Request) {
  try {
    const requestId = generateRequestId()
    const body = await request.json()
    const { credential, workflowId, userId } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (userId !== undefined && userId !== null) {
      const validation = validateAlphanumericId(userId, 'userId', 100)
      if (!validation.isValid) {
        logger.warn('Invalid Slack user ID', { userId, error: validation.error })
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }
    }

    let accessToken: string
    const isBotToken = credential.startsWith('xoxb-')

    if (isBotToken) {
      accessToken = credential
      logger.info('Using direct bot token for Slack API')
    } else {
      const authz = await authorizeCredentialUse(request as any, {
        credentialId: credential,
        workflowId,
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
    }

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
    logger.error('Error processing Slack users request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Slack users', details: (error as Error).message },
      { status: 500 }
    )
  }
}

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

async function fetchSlackUsers(accessToken: string) {
  const url = new URL('https://slack.com/api/users.list')
  url.searchParams.append('limit', '200')

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

  return data
}
