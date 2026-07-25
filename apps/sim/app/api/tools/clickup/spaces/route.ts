import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { clickupSpacesSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { CLICKUP_API_BASE_URL, clickupAuthorizationHeader } from '@/tools/clickup/shared'

const logger = createLogger('ClickUpSpacesAPI')

export const dynamic = 'force-dynamic'

interface ClickUpNamedResource {
  id: string | number
  name?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const requestId = generateRequestId()
    const parsed = await parseRequest(clickupSpacesSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId, teamId } = parsed.data.body

    const teamIdValidation = validateAlphanumericId(teamId, 'teamId')
    if (!teamIdValidation.isValid) {
      logger.error('Invalid teamId', { error: teamIdValidation.error })
      return NextResponse.json({ error: teamIdValidation.error }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId: credential,
      workflowId,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credential,
      authz.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      logger.error('Failed to get access token', {
        credentialId: credential,
        userId: authz.credentialOwnerUserId,
      })
      return NextResponse.json(
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const response = await fetch(
      `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(teamId)}/space`,
      {
        headers: {
          Authorization: clickupAuthorizationHeader(accessToken),
          Accept: 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch ClickUp spaces', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch ClickUp spaces' },
        { status: response.status }
      )
    }

    const data = (await response.json().catch(() => ({}))) as {
      spaces?: ClickUpNamedResource[]
    }
    const spaces = (Array.isArray(data.spaces) ? data.spaces : []).map((item) => ({
      id: String(item.id),
      name: item.name || `Space ${item.id}`,
    }))

    return NextResponse.json({ spaces })
  } catch (error) {
    logger.error('Error fetching ClickUp spaces', error)
    return NextResponse.json({ error: 'Failed to fetch ClickUp spaces' }, { status: 500 })
  }
})
