import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { clickupFoldersSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { CLICKUP_API_BASE_URL, clickupAuthorizationHeader } from '@/tools/clickup/shared'

const logger = createLogger('ClickUpFoldersAPI')

export const dynamic = 'force-dynamic'

interface ClickUpNamedResource {
  id: string | number
  name?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const requestId = generateRequestId()
    const parsed = await parseRequest(clickupFoldersSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId, spaceId } = parsed.data.body

    const spaceIdValidation = validateAlphanumericId(spaceId, 'spaceId')
    if (!spaceIdValidation.isValid) {
      logger.error('Invalid spaceId', { error: spaceIdValidation.error })
      return NextResponse.json({ error: spaceIdValidation.error }, { status: 400 })
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
      `${CLICKUP_API_BASE_URL}/space/${encodeURIComponent(spaceId)}/folder`,
      {
        headers: {
          Authorization: clickupAuthorizationHeader(accessToken),
          Accept: 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch ClickUp folders', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch ClickUp folders' },
        { status: response.status }
      )
    }

    const data = (await response.json().catch(() => ({}))) as {
      folders?: ClickUpNamedResource[]
    }
    const folders = (Array.isArray(data.folders) ? data.folders : []).map((item) => ({
      id: String(item.id),
      name: item.name || `Folder ${item.id}`,
    }))

    return NextResponse.json({ folders })
  } catch (error) {
    logger.error('Error fetching ClickUp folders', error)
    return NextResponse.json({ error: 'Failed to fetch ClickUp folders' }, { status: 500 })
  }
})
