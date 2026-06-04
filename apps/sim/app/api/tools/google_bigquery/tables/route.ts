import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { bigQueryTablesSelectorContract } from '@/lib/api/contracts/selectors/bigquery'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { drainGooglePagedList, GooglePageError } from '@/lib/oauth/google-pagination'
import { getScopesForService } from '@/lib/oauth/utils'
import { refreshAccessTokenIfNeeded, ServiceAccountTokenError } from '@/app/api/auth/oauth/utils'

const logger = createLogger('GoogleBigQueryTablesAPI')

export const dynamic = 'force-dynamic'

const MAX_TABLE_PAGES = 20
const TABLE_PAGE_SIZE = 200

interface BigQueryTable {
  tableReference: { tableId: string }
  friendlyName?: string
}

interface BigQueryTablesResponse {
  tables?: BigQueryTable[]
  nextPageToken?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(
      bigQueryTablesSelectorContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          const hasCredentialError = error.issues.some((issue) => issue.path[0] === 'credential')
          if (hasCredentialError) {
            logger.error('Missing credential in request')
            return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
          }

          const hasProjectIdError = error.issues.some((issue) => issue.path[0] === 'projectId')
          if (hasProjectIdError) {
            logger.error('Missing project ID in request')
            return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
          }

          logger.error('Missing dataset ID in request')
          return NextResponse.json({ error: 'Dataset ID is required' }, { status: 400 })
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { credential, workflowId, projectId, datasetId, impersonateEmail } = parsed.data.body

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
      requestId,
      getScopesForService('google-bigquery'),
      impersonateEmail
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

    const { items } = await drainGooglePagedList<BigQueryTable, BigQueryTablesResponse>({
      buildUrl: (pageToken) => {
        const url = new URL(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/tables`
        )
        url.searchParams.set('maxResults', String(TABLE_PAGE_SIZE))
        if (pageToken) url.searchParams.set('pageToken', pageToken)
        return url.toString()
      },
      fetch: (url) =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      parseError: (response) => response.json().catch(() => ({})),
      getItems: (body) => body.tables,
      getNextPageToken: (body) => body.nextPageToken,
      maxPages: MAX_TABLE_PAGES,
      label: 'BigQuery tables',
    })

    const tables = items.map((t) => ({
      tableReference: t.tableReference,
      friendlyName: t.friendlyName,
    }))

    return NextResponse.json({ tables })
  } catch (error) {
    if (error instanceof GooglePageError) {
      logger.error('Failed to fetch BigQuery tables', {
        status: error.status,
        error: error.body,
      })
      return NextResponse.json(
        { error: 'Failed to fetch BigQuery tables', details: error.body },
        { status: error.status }
      )
    }
    if (error instanceof ServiceAccountTokenError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('Error processing BigQuery tables request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve BigQuery tables', details: (error as Error).message },
      { status: 500 }
    )
  }
})
