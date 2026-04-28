import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validatePathSegment, validateSharePointSiteId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { GRAPH_ID_PATTERN } from '@/tools/microsoft_excel/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftExcelDrivesAPI')

interface GraphDrive {
  id: string
  name: string
  driveType: string
  webUrl?: string
}

/**
 * List document libraries (drives) for a SharePoint site.
 * Used by the microsoft.excel.drives selector to let users pick
 * which drive contains their Excel file.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const body = await request.json()
    const { credential, workflowId, siteId, driveId } = body

    if (!credential) {
      logger.warn(`[${requestId}] Missing credential in request`)
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (!siteId) {
      logger.warn(`[${requestId}] Missing siteId in request`)
      return NextResponse.json({ error: 'Site ID is required' }, { status: 400 })
    }

    const siteIdValidation = validateSharePointSiteId(siteId, 'siteId')
    if (!siteIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid siteId format`)
      return NextResponse.json({ error: siteIdValidation.error }, { status: 400 })
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
      logger.warn(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json(
        { error: 'Failed to obtain valid access token', authRequired: true },
        { status: 401 }
      )
    }

    // Single-drive lookup when driveId is provided (used by fetchById)
    if (driveId) {
      const driveIdValidation = validatePathSegment(driveId, {
        paramName: 'driveId',
        customPattern: GRAPH_ID_PATTERN,
      })
      if (!driveIdValidation.isValid) {
        return NextResponse.json({ error: driveIdValidation.error }, { status: 400 })
      }

      const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}?$select=id,name,driveType,webUrl`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: { message: 'Unknown error' } }))
        return NextResponse.json(
          { error: errorData.error?.message || 'Failed to fetch drive' },
          { status: response.status }
        )
      }

      const data: GraphDrive = await response.json()
      return NextResponse.json(
        { drive: { id: data.id, name: data.name, driveType: data.driveType } },
        { status: 200 }
      )
    }

    // List all drives for the site
    const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives?$select=id,name,driveType,webUrl`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Microsoft Graph API error fetching drives`, {
        status: response.status,
        error: errorData.error?.message,
      })
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch drives' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const drives = (data.value || []).map((drive: GraphDrive) => ({
      id: drive.id,
      name: drive.name,
      driveType: drive.driveType,
    }))

    logger.info(`[${requestId}] Successfully fetched ${drives.length} drives for site ${siteId}`)
    return NextResponse.json({ drives }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching drives`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
