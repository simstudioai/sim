import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftExcelAPI')

interface Worksheet {
  id: string
  name: string
  position: number
  visibility: string
}

interface WorksheetsResponse {
  value: Worksheet[]
}

/**
 * Get worksheets (tabs) from a Microsoft Excel workbook
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Microsoft Excel sheets request received`)

  try {
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const spreadsheetId = searchParams.get('spreadsheetId')
    const workflowId = searchParams.get('workflowId') || undefined

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credentialId parameter`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    if (!spreadsheetId) {
      logger.warn(`[${requestId}] Missing spreadsheetId parameter`)
      return NextResponse.json({ error: 'Spreadsheet ID is required' }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, { credentialId, workflowId })
    if (!authz.ok || !authz.credentialOwnerUserId) {
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

    logger.info(
      `[${requestId}] Fetching worksheets from Microsoft Graph API for workbook ${spreadsheetId}`
    )

    // Fetch worksheets from Microsoft Graph API
    const worksheetsResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!worksheetsResponse.ok) {
      const errorData = await worksheetsResponse
        .text()
        .then((text) => JSON.parse(text))
        .catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Microsoft Graph API error`, {
        status: worksheetsResponse.status,
        error: errorData.error?.message || 'Failed to fetch worksheets',
      })
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch worksheets' },
        { status: worksheetsResponse.status }
      )
    }

    const data: WorksheetsResponse = await worksheetsResponse.json()
    const worksheets = data.value || []

    // Sort worksheets by position
    worksheets.sort((a, b) => a.position - b.position)

    logger.info(`[${requestId}] Successfully fetched ${worksheets.length} worksheets`)

    return NextResponse.json({
      sheets: worksheets.map((worksheet) => ({
        id: worksheet.name, // Use name as ID since that's what the API uses for addressing
        name: worksheet.name,
        worksheetId: worksheet.id,
        position: worksheet.position,
        visibility: worksheet.visibility,
      })),
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Microsoft Excel worksheets`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
