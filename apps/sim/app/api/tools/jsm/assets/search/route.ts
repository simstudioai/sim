import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { jsmSearchObjectsAqlContract } from '@/lib/api/contracts/selectors/jsm'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  validateAssetsWorkspaceId,
  validateJiraCloudId,
} from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseAtlassianErrorMessage } from '@/tools/jira/utils'
import {
  getAssetsApiBaseUrl,
  getJsmHeaders,
  mapAssetObject,
  resolveAssetsContext,
} from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmAssetsSearchAPI')

/** Coerce a string|number|boolean param into a number, falling back when unset */
function toNumber(value: string | number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(jsmSearchObjectsAqlContract, request, {})
    if (!parsed.success) return parsed.response

    const {
      domain,
      accessToken,
      cloudId: cloudIdParam,
      workspaceId: workspaceIdParam,
      qlQuery,
      page,
      resultsPerPage,
      includeAttributes,
      objectTypeId,
      objectSchemaId,
    } = parsed.data.body

    const { cloudId, workspaceId } = await resolveAssetsContext(
      domain,
      accessToken,
      cloudIdParam,
      workspaceIdParam
    )

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const workspaceIdValidation = validateAssetsWorkspaceId(workspaceId, 'workspaceId')
    if (!workspaceIdValidation.isValid) {
      return NextResponse.json({ error: workspaceIdValidation.error }, { status: 400 })
    }

    const includeAttrs =
      includeAttributes === undefined ? true : String(includeAttributes) === 'true'

    const body: Record<string, unknown> = {
      qlQuery,
      page: toNumber(page, 1),
      resultsPerPage: toNumber(resultsPerPage, 25),
      includeAttributes: includeAttrs,
    }
    if (objectTypeId) body.objectTypeId = objectTypeId
    if (objectSchemaId) body.objectSchemaId = objectSchemaId

    const url = `${getAssetsApiBaseUrl(cloudId, workspaceId)}/object/aql`

    const response = await fetch(url, {
      method: 'POST',
      headers: getJsmHeaders(accessToken),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Assets API error running AQL search', { status: response.status, errorText })
      return NextResponse.json(
        {
          error: parseAtlassianErrorMessage(response.status, response.statusText, errorText),
          details: errorText,
        },
        { status: response.status }
      )
    }

    const data = await response.json()

    return NextResponse.json({
      success: true,
      output: {
        ts: new Date().toISOString(),
        objects: Array.isArray(data.objectEntries) ? data.objectEntries.map(mapAssetObject) : [],
        total: data.totalFilterCount ?? (data.objectEntries?.length || 0),
        pageNumber: data.pageNumber ?? 1,
        pageSize: data.pageSize ?? (data.objectEntries?.length || 0),
      },
    })
  } catch (error) {
    logger.error('Error running Assets AQL search', { error: toError(error).message })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Internal server error'), success: false },
      { status: 500 }
    )
  }
})
