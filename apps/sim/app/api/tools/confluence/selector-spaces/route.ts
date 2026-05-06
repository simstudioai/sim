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

    /**
     * Confluence v2 `/spaces` defaults to `status=current` and treats `status`
     * as a single-value enum, so archived spaces never surface from one call.
     * Listing both surfaces archived spaces in the dropdown — they would
     * otherwise only be reachable by typing the space key manually, even
     * though sync works against archived spaces just fine.
     */
    async function fetchAllPages(status: 'current' | 'archived'): Promise<{
      spaces: { id: string; name: string; key: string; status: string }[]
      capped: boolean
    }> {
      const collected: { id: string; name: string; key: string; status: string }[] = []
      let cursor: string | undefined
      let pageCount = 0

      while (pageCount < MAX_PAGES) {
        const params = new URLSearchParams({ limit: String(PAGE_LIMIT), status })
        if (cursor) params.set('cursor', cursor)
        const url = `${baseUrl}?${params.toString()}`

        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(
            parseAtlassianErrorMessage(response.status, response.statusText, errorText)
          )
        }

        const data = await response.json()
        for (const space of data.results || []) {
          collected.push({ id: space.id, name: space.name, key: space.key, status })
        }

        const nextLink = data._links?.next as string | undefined
        if (!nextLink) return { spaces: collected, capped: false }
        try {
          cursor = new URL(nextLink, 'https://placeholder').searchParams.get('cursor') || undefined
        } catch {
          cursor = undefined
        }
        if (!cursor) return { spaces: collected, capped: false }
        pageCount += 1
      }

      return { spaces: collected, capped: true }
    }

    let currentResult: Awaited<ReturnType<typeof fetchAllPages>>
    let archivedResult: Awaited<ReturnType<typeof fetchAllPages>>
    try {
      ;[currentResult, archivedResult] = await Promise.all([
        fetchAllPages('current'),
        fetchAllPages('archived'),
      ])
    } catch (error) {
      logger.error('Confluence API error response', { error: (error as Error).message })
      return NextResponse.json({ error: (error as Error).message }, { status: 502 })
    }

    if (currentResult.capped || archivedResult.capped) {
      logger.warn('Confluence space listing hit pagination cap', {
        cap: MAX_PAGES * PAGE_LIMIT,
        currentCount: currentResult.spaces.length,
        archivedCount: archivedResult.spaces.length,
      })
    }

    const spaces = [...currentResult.spaces, ...archivedResult.spaces]
    return NextResponse.json({ spaces })
  } catch (error) {
    logger.error('Error listing Confluence spaces:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
