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

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(confluenceSpacesSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { credential, workflowId, domain } = parsed.data.body

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

    // Resolve once so we know whether this is an Atlassian SA credential before
    // doing any token / cloudId work. Atlassian SAs short-circuit the entire path:
    // the API token IS the access token, and cloudId lives in the encrypted secret —
    // so we skip refreshAccessTokenIfNeeded (avoids a redundant resolve+decrypt) and
    // skip getConfluenceCloudId (which 401s for scoped SA tokens).
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
    const PAGE_LIMIT = 250
    const MAX_PAGES = 20
    const spaces: { id: string; name: string; key: string }[] = []
    let cursor: string | undefined
    let pageCount = 0

    while (pageCount < MAX_PAGES) {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) })
      if (cursor) params.set('cursor', cursor)
      const url = `${baseUrl}?${params.toString()}`

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Confluence API error response:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        })
        return NextResponse.json(
          { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
          { status: response.status }
        )
      }

      const data = await response.json()
      for (const space of data.results || []) {
        spaces.push({ id: space.id, name: space.name, key: space.key })
      }

      const nextLink = data._links?.next as string | undefined
      if (!nextLink) break
      try {
        cursor = new URL(nextLink, 'https://placeholder').searchParams.get('cursor') || undefined
      } catch {
        cursor = undefined
      }
      if (!cursor) break
      pageCount += 1
    }

    if (pageCount >= MAX_PAGES) {
      logger.warn('Confluence space listing hit pagination cap', {
        cap: MAX_PAGES * PAGE_LIMIT,
        returned: spaces.length,
      })
    }

    return NextResponse.json({ spaces })
  } catch (error) {
    logger.error('Error listing Confluence spaces:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
