import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { hubspotPipelinesSelectorContract } from '@/lib/api/contracts/selectors/hubspot'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId, validatePathSegment } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'

export const dynamic = 'force-dynamic'

const logger = createLogger('HubSpotPipelinesAPI')

/**
 * Built-in object slugs map to a safe plural constant; anything else falls
 * through to the caller-supplied `objectType`, which the contract constrains
 * only to a non-empty string. That value lands in a path segment, so it is
 * validated before use — `encodeURIComponent` alone leaves a `.`/`..` segment
 * intact and the WHATWG parser removes it, re-aiming the authenticated request.
 *
 * The lookup goes through `Object.hasOwn` rather than plain indexing: on a
 * plain object literal, `objectType = 'constructor'` (or `'__proto__'`,
 * `'toString'`, …) resolves through the prototype chain to a function, the
 * `?? objectType` fallback never fires, and `validatePathSegment` then calls a
 * string method on a non-string and throws — turning caller-controlled input
 * into a 500. Those names are legal HubSpot custom-object spellings, so they
 * must reach the validator as the strings they are.
 */
const BUILT_IN_PATH: Record<string, string> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
  ticket: 'tickets',
}

interface HubSpotPipeline {
  id: string
  label: string
  stages?: Array<{ id: string; label: string }>
  archived?: boolean
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(hubspotPipelinesSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId, objectType } = parsed.data.query

    const credentialIdValidation = validateAlphanumericId(credentialId, 'credentialId', 255)
    if (!credentialIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid credential ID: ${credentialIdValidation.error}`)
      return NextResponse.json({ error: credentialIdValidation.error }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      requireWorkflowIdForInternal: false,
    })
    if (!authz.ok || !authz.credentialOwnerUserId || !authz.resolvedCredentialId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      authz.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const pathSegment = Object.hasOwn(BUILT_IN_PATH, objectType)
      ? BUILT_IN_PATH[objectType]
      : objectType
    const pathSegmentValidation = validatePathSegment(pathSegment, { paramName: 'objectType' })
    if (!pathSegmentValidation.isValid) {
      logger.warn(`[${requestId}] Invalid objectType: ${pathSegmentValidation.error}`)
      return NextResponse.json({ error: pathSegmentValidation.error }, { status: 400 })
    }

    const response = await fetch(
      `https://api.hubapi.com/crm/v3/pipelines/${encodeURIComponent(pathSegment)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error(`[${requestId}] HubSpot pipelines API error ${response.status}: ${errorText}`)
      return NextResponse.json(
        { error: errorText || 'Failed to fetch HubSpot pipelines' },
        { status: response.status }
      )
    }

    const data = (await response.json()) as { results?: HubSpotPipeline[] }
    const pipelines = (data.results ?? [])
      .filter((p) => !p.archived)
      .map((p) => ({
        id: p.id,
        name: p.label,
        stages: p.stages?.map((s) => ({ id: s.id, label: s.label })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ pipelines }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching HubSpot pipelines:`, error)
    return NextResponse.json({ error: 'Failed to fetch HubSpot pipelines' }, { status: 500 })
  }
})
