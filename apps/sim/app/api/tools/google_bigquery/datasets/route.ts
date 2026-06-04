import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { bigQueryDatasetsSelectorContract } from '@/lib/api/contracts/selectors/bigquery'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { drainGooglePagedList, GooglePageError } from '@/lib/oauth/google-pagination'
import { getScopesForService } from '@/lib/oauth/utils'
import { refreshAccessTokenIfNeeded, ServiceAccountTokenError } from '@/app/api/auth/oauth/utils'

const logger = createLogger('GoogleBigQueryDatasetsAPI')

export const dynamic = 'force-dynamic'

const MAX_DATASET_PAGES = 20
const DATASET_PAGE_SIZE = 200

interface BigQueryDataset {
  datasetReference: { datasetId: string; projectId: string }
  friendlyName?: string
}

interface BigQueryDatasetsResponse {
  datasets?: BigQueryDataset[]
  nextPageToken?: string
}

/**
 * POST /api/tools/google_bigquery/datasets
 *
 * Fetches the list of BigQuery datasets for a given project using the caller's OAuth credential.
 *
 * @param request - Incoming request containing `credential`, `workflowId`, and `projectId` in the JSON body
 * @returns JSON response with a `datasets` array, each entry containing `datasetReference` and optional `friendlyName`
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(
      bigQueryDatasetsSelectorContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          const path = error.issues.at(0)?.path[0]
          const message =
            path === 'credential'
              ? 'Credential is required'
              : path === 'projectId'
                ? 'Project ID is required'
                : getValidationErrorMessage(error, 'Invalid request')
          logger.error(`Validation failed for BigQuery datasets request: ${message}`)
          return NextResponse.json({ error: message }, { status: 400 })
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { credential, workflowId, projectId, impersonateEmail } = parsed.data.body

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

    const { items } = await drainGooglePagedList<BigQueryDataset, BigQueryDatasetsResponse>({
      buildUrl: (pageToken) => {
        const url = new URL(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets`
        )
        url.searchParams.set('maxResults', String(DATASET_PAGE_SIZE))
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
      getItems: (body) => body.datasets,
      getNextPageToken: (body) => body.nextPageToken,
      maxPages: MAX_DATASET_PAGES,
      label: 'BigQuery datasets',
    })

    const datasets = items.map((ds) => ({
      datasetReference: ds.datasetReference,
      friendlyName: ds.friendlyName,
    }))

    return NextResponse.json({ datasets })
  } catch (error) {
    if (error instanceof GooglePageError) {
      logger.error('Failed to fetch BigQuery datasets', {
        status: error.status,
        error: error.body,
      })
      return NextResponse.json(
        { error: 'Failed to fetch BigQuery datasets', details: error.body },
        { status: error.status }
      )
    }
    if (error instanceof ServiceAccountTokenError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('Error processing BigQuery datasets request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve BigQuery datasets', details: (error as Error).message },
      { status: 500 }
    )
  }
})
