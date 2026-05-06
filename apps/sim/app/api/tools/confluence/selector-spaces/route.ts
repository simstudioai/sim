import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { confluenceSpacesSelectorContract } from '@/lib/api/contracts/selectors/confluence'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateJiraCloudId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  getAtlassianServiceAccountSecret,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/app/api/auth/oauth/utils'
import { getConfluenceCloudId } from '@/tools/confluence/utils'
import { parseAtlassianErrorMessage } from '@/tools/jira/utils'

const logger = createLogger('ConfluenceSelectorSpacesAPI')

export const dynamic = 'force-dynamic'

const PAGE_LIMIT = 250

type SpaceStatus = 'current' | 'archived'

/**
 * Cursor format: `<status>:<innerCursor>`. Empty inner cursor means "first page
 * of that status". When current is exhausted we hand back `archived:` so the
 * client transparently flips to the archived stream — listing both surfaces
 * archived spaces in the dropdown, which would otherwise only be reachable by
 * typing the space key manually even though sync works against archived spaces.
 */
function parseCursor(raw: string | undefined): { status: SpaceStatus; inner?: string } {
  if (!raw) return { status: 'current' }
  const idx = raw.indexOf(':')
  if (idx === -1) return { status: 'current' }
  const status = raw.slice(0, idx) === 'archived' ? 'archived' : 'current'
  const inner = raw.slice(idx + 1)
  return { status, inner: inner || undefined }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(confluenceSpacesSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { credential, workflowId, domain, cursor } = parsed.data.body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId: credential,
      workflowId,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const resolved = await resolveOAuthAccountId(credential)
    const isAtlassianServiceAccount =
      resolved?.providerId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID && !!resolved.credentialId

    let accessToken: string | null
    let cloudId: string
    if (isAtlassianServiceAccount) {
      const secret = await getAtlassianServiceAccountSecret(resolved.credentialId!)
      accessToken = secret.apiToken
      cloudId = secret.cloudId
    } else {
      accessToken = await refreshAccessTokenIfNeeded(
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
      cloudId = await getConfluenceCloudId(domain, accessToken)
    }

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const baseUrl = `https://api.atlassian.com/ex/confluence/${cloudIdValidation.sanitized}/wiki/api/v2/spaces`
    const { status, inner } = parseCursor(cursor)

    const params = new URLSearchParams({ limit: String(PAGE_LIMIT), status })
    if (inner) params.set('cursor', inner)
    const url = `${baseUrl}?${params.toString()}`

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const errorText = await response.text()
      const message = parseAtlassianErrorMessage(response.status, response.statusText, errorText)
      logger.error('Confluence API error response', { error: message, status: response.status })
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const data = await response.json()
    const spaces = (data.results || []).map((space: { id: string; name: string; key: string }) => ({
      id: space.id,
      name: space.name,
      key: space.key,
      status,
    }))

    let nextInner: string | undefined
    const nextLink = data._links?.next as string | undefined
    if (nextLink) {
      try {
        nextInner = new URL(nextLink, 'https://placeholder').searchParams.get('cursor') || undefined
      } catch {
        nextInner = undefined
      }
    }

    let nextCursor: string | undefined
    if (nextInner) {
      nextCursor = `${status}:${nextInner}`
    } else if (status === 'current') {
      nextCursor = 'archived:'
    }

    return NextResponse.json({ spaces, nextCursor })
  } catch (error) {
    logger.error('Error listing Confluence spaces:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
