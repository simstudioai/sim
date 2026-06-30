import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { jsmDeleteObjectContract } from '@/lib/api/contracts/selectors/jsm'
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

const logger = createLogger('JsmAssetsDeleteObjectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(jsmDeleteObjectContract, request, {})
    if (!parsed.success) return parsed.response

    const {
      domain,
      accessToken,
      cloudId: cloudIdParam,
      workspaceId: workspaceIdParam,
      objectId,
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

    const url = `${getAssetsApiBaseUrl(cloudId, workspaceId)}/object/${encodeURIComponent(objectId)}`

    const response = await fetch(url, { method: 'DELETE', headers: getJsmHeaders(accessToken) })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Assets API error deleting object', { status: response.status, errorText })
      return NextResponse.json(
        {
          error: parseAtlassianErrorMessage(response.status, response.statusText, errorText),
          details: errorText,
        },
        { status: response.status }
      )
    }

    return NextResponse.json({
      success: true,
      output: { ts: new Date().toISOString(), objectId, deleted: true },
    })
  } catch (error) {
    logger.error('Error deleting Assets object', { error: toError(error).message })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Internal server error'), success: false },
      { status: 500 }
    )
  }
})
