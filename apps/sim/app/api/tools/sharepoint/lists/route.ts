import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateSharePointSiteId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SharePointListsAPI')

interface SharePointList {
  id: string
  displayName: string
  description?: string
  webUrl?: string
  list?: {
    hidden?: boolean
  }
}

export async function POST(request: Request) {
  const requestId = generateRequestId()

  try {
    const body = await request.json()
    const { credential, workflowId, siteId } = body

    if (!credential) {
      logger.error(`[${requestId}] Missing credential in request`)
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    const siteIdValidation = validateSharePointSiteId(siteId)
    if (!siteIdValidation.isValid) {
      logger.error(`[${requestId}] Invalid siteId: ${siteIdValidation.error}`)
      return NextResponse.json({ error: siteIdValidation.error }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request as any, {
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
      logger.error(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json(
        { error: 'Failed to obtain valid access token', authRequired: true },
        { status: 401 }
      )
    }

    const url = `https://graph.microsoft.com/v1.0/sites/${siteIdValidation.sanitized}/lists?$select=id,displayName,description,webUrl&$expand=list($select=hidden)&$top=100`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch lists from SharePoint' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const lists = (data.value || [])
      .filter((list: SharePointList) => list.list?.hidden !== true)
      .map((list: SharePointList) => ({
        id: list.id,
        displayName: list.displayName,
      }))

    logger.info(`[${requestId}] Successfully fetched ${lists.length} SharePoint lists`)
    return NextResponse.json({ lists }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching lists from SharePoint`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
