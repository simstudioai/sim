import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { airtableTablesSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAirtableId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('AirtableTablesAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(airtableTablesSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId, baseId } = parsed.data.body

    const baseIdValidation = validateAirtableId(baseId, 'app', 'baseId')
    if (!baseIdValidation.isValid) {
      logger.error('Invalid baseId', { error: baseIdValidation.error })
      return NextResponse.json({ error: baseIdValidation.error }, { status: 400 })
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
      logger.error('Failed to get access token', {
        credentialId: credential,
        userId: authz.credentialOwnerUserId,
      })
      return NextResponse.json(
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const response = await fetch(
      `https://api.airtable.com/v0/meta/bases/${baseIdValidation.sanitized}/tables`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Airtable tables', {
        status: response.status,
        error: errorData,
        baseId,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Airtable tables', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const tables = (data.tables || []).map((table: { id: string; name: string }) => ({
      id: table.id,
      name: table.name,
    }))

    return NextResponse.json({ tables })
  } catch (error) {
    logger.error('Error processing Airtable tables request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Airtable tables', details: (error as Error).message },
      { status: 500 }
    )
  }
})
