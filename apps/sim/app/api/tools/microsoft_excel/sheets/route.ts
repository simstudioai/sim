import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftExcelSheetsSelectorContract } from '@/lib/api/contracts/selectors/microsoft'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { extractGraphError, getItemBasePath } from '@/tools/microsoft_excel/utils'

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
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Microsoft Excel sheets request received`)

  try {
    const parsed = await parseRequest(microsoftExcelSheetsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId, spreadsheetId, driveId, workflowId } = parsed.data.query

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

    let basePath: string
    try {
      basePath = getItemBasePath(spreadsheetId, driveId)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid parameters' },
        { status: 400 }
      )
    }

    const worksheetsResponse = await fetch(`${basePath}/workbook/worksheets`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!worksheetsResponse.ok) {
      const errorMessage = await extractGraphError(worksheetsResponse)
      logger.error(`[${requestId}] Microsoft Graph API error`, {
        status: worksheetsResponse.status,
        error: errorMessage,
      })
      return NextResponse.json({ error: errorMessage }, { status: worksheetsResponse.status })
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
})
