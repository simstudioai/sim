import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('GoogleBigQueryTablesAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const requestId = generateRequestId()
  try {
    const body = await request.json()
    const { credential, workflowId, projectId, datasetId } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (!projectId) {
      logger.error('Missing project ID in request')
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    if (!datasetId) {
      logger.error('Missing dataset ID in request')
      return NextResponse.json({ error: 'Dataset ID is required' }, { status: 400 })
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
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/tables?maxResults=200`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch BigQuery tables', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch BigQuery tables', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const tables = (data.tables || []).map(
      (t: { tableReference: { tableId: string }; friendlyName?: string }) => ({
        tableReference: t.tableReference,
        friendlyName: t.friendlyName,
      })
    )

    return NextResponse.json({ tables })
  } catch (error) {
    logger.error('Error processing BigQuery tables request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve BigQuery tables', details: (error as Error).message },
      { status: 500 }
    )
  }
}
