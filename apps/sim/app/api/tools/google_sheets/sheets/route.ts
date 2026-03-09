import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleSheetsAPI')

interface SheetProperties {
  sheetId: number
  title: string
  index: number
}

interface Sheet {
  properties: SheetProperties
}

interface SpreadsheetResponse {
  sheets: Sheet[]
}

/**
 * Get sheets (tabs) from a Google Spreadsheet
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Google Sheets sheets request received`)

  const auth = await checkSessionOrInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

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
      `[${requestId}] Fetching sheets from Google Sheets API for spreadsheet ${spreadsheetId}`
    )

    // Fetch spreadsheet metadata to get sheet names
    const sheetsResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!sheetsResponse.ok) {
      const errorData = await sheetsResponse
        .text()
        .then((text) => JSON.parse(text))
        .catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Google Sheets API error`, {
        status: sheetsResponse.status,
        error: errorData.error?.message || 'Failed to fetch sheets',
      })
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch sheets' },
        { status: sheetsResponse.status }
      )
    }

    const data: SpreadsheetResponse = await sheetsResponse.json()
    const sheets = data.sheets || []

    // Sort sheets by index
    sheets.sort((a, b) => a.properties.index - b.properties.index)

    logger.info(`[${requestId}] Successfully fetched ${sheets.length} sheets`)

    return NextResponse.json({
      sheets: sheets.map((sheet) => ({
        id: sheet.properties.title, // Use title as ID since that's what the API uses
        name: sheet.properties.title,
        sheetId: sheet.properties.sheetId,
        index: sheet.properties.index,
      })),
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Google Sheets sheets`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
