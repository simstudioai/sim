import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { jsmListObjectSchemasContract } from '@/lib/api/contracts/selectors/jsm'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  validateAssetsWorkspaceId,
  validateJiraCloudId,
} from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseAtlassianErrorMessage } from '@/tools/jira/utils'
import { getAssetsApiBaseUrl, getJsmHeaders, resolveAssetsContext } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmAssetsSchemasAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(jsmListObjectSchemasContract, request, {})
    if (!parsed.success) return parsed.response

    const {
      domain,
      accessToken,
      cloudId: cloudIdParam,
      workspaceId: workspaceIdParam,
      startAt,
      maxResults,
      includeCounts,
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

    const query = new URLSearchParams()
    if (startAt !== undefined) query.append('startAt', String(startAt))
    if (maxResults !== undefined) query.append('maxResults', String(maxResults))
    if (includeCounts !== undefined) query.append('includeCounts', String(includeCounts))

    const url = `${getAssetsApiBaseUrl(cloudId, workspaceId)}/objectschema/list${
      query.toString() ? `?${query.toString()}` : ''
    }`

    const response = await fetch(url, { method: 'GET', headers: getJsmHeaders(accessToken) })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Assets API error listing schemas', { status: response.status, errorText })
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
        schemas: data.values ?? [],
        total: data.total ?? (data.values?.length || 0),
        isLast: data.isLast ?? data.last ?? true,
      },
    })
  } catch (error) {
    logger.error('Error listing Assets schemas', { error: toError(error).message })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Internal server error'), success: false },
      { status: 500 }
    )
  }
})
