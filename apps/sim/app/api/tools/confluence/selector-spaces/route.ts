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

/** A row as Confluence returns it. `status` is not marked required in the v2 schema. */
interface SpaceRow {
  id: string
  name: string
  key: string
  status?: SpaceStatus
}

interface SpacesResponse {
  results?: SpaceRow[]
  _links?: { next?: string }
}

/** A row as this selector emits it, with `status` always resolved. */
interface SelectorSpace {
  id: string
  name: string
  key: string
  status: SpaceStatus
}

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

    const { credential, workflowId, domain, cursor, spaceKey } = parsed.data.body

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

    const requestSpaces = async (
      search: URLSearchParams
    ): Promise<{ ok: true; data: SpacesResponse } | { ok: false; response: NextResponse }> => {
      const response = await fetch(`${baseUrl}?${search.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const errorText = await response.text()
        const message = parseAtlassianErrorMessage(response.status, response.statusText, errorText)
        logger.error('Confluence API error response', { error: message, status: response.status })
        return { ok: false, response: NextResponse.json({ error: message }, { status: 502 }) }
      }

      return { ok: true, data: await response.json() }
    }

    const toSpaces = (rows: SpaceRow[] | undefined, queried: SpaceStatus): SelectorSpace[] =>
      (rows ?? []).map((space) => ({
        id: space.id,
        name: space.name,
        key: space.key,
        // Trust the row's own status; fall back to the status this call asked for.
        status: space.status ?? queried,
      }))

    if (spaceKey) {
      /**
       * Exact-key lookup, bypassing the paged drain the dropdown otherwise depends
       * on. Both statuses are queried explicitly rather than omitting `status`: it
       * takes a single value on this endpoint (unlike `/pages`, where it is an array
       * with a documented `current,archived` default) and `/spaces` documents no
       * default, while archived spaces are reachable in the paged path and sync works
       * against them. Concurrent because the key is user-typed text, so a miss — which
       * dominates while typing — would otherwise pay two round-trips.
       */
      const [current, archived] = await Promise.all([
        requestSpaces(
          new URLSearchParams({ keys: spaceKey, limit: String(PAGE_LIMIT), status: 'current' })
        ),
        requestSpaces(
          new URLSearchParams({ keys: spaceKey, limit: String(PAGE_LIMIT), status: 'archived' })
        ),
      ])
      // Only a total failure is fatal: one leg erroring must not discard a match
      // the other leg found.
      if (!current.ok && !archived.ok) return current.response

      // A single resolution, never a page in a drained stream, so no cursor.
      return NextResponse.json({
        spaces: [
          ...(current.ok ? toSpaces(current.data.results, 'current') : []),
          ...(archived.ok ? toSpaces(archived.data.results, 'archived') : []),
        ],
        nextCursor: undefined,
      })
    }

    const params = new URLSearchParams({ limit: String(PAGE_LIMIT), status })
    if (inner) params.set('cursor', inner)
    const result = await requestSpaces(params)
    if (!result.ok) return result.response
    const data = result.data

    let nextInner: string | undefined
    const nextLink = data._links?.next
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

    return NextResponse.json({ spaces: toSpaces(data.results, status), nextCursor })
  } catch (error) {
    logger.error('Error listing Confluence spaces:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
