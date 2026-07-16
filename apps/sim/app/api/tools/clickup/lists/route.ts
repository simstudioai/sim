import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { clickupListsSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { CLICKUP_API_BASE_URL, clickupAuthorizationHeader } from '@/tools/clickup/shared'

const logger = createLogger('ClickUpListsAPI')

export const dynamic = 'force-dynamic'

interface ClickUpNamedResource {
  id: string | number
  name?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const parsed = await parseRequest(clickupListsSelectorContract, request, {})
  if (!parsed.success) return parsed.response
  const { credential, workflowId, folderId, spaceId } = parsed.data.body

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
    folderId?.trim()
      ? `${CLICKUP_API_BASE_URL}/folder/${encodeURIComponent(folderId.trim())}/list`
      : `${CLICKUP_API_BASE_URL}/space/${encodeURIComponent((spaceId ?? '').trim())}/list`,
    {
      headers: {
        Authorization: clickupAuthorizationHeader(accessToken),
        Accept: 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error('Failed to fetch ClickUp lists', {
      status: response.status,
      error: errorData,
    })
    return NextResponse.json(
      { error: 'Failed to fetch ClickUp lists' },
      { status: response.status }
    )
  }

  const data = (await response.json().catch(() => ({}))) as {
    lists?: ClickUpNamedResource[]
  }
  const lists = (Array.isArray(data.lists) ? data.lists : []).map((item) => ({
    id: String(item.id),
    name: item.name || `List ${item.id}`,
  }))

  return NextResponse.json({ lists })
})
