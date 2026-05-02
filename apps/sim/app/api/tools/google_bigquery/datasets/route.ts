import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { bigQueryDatasetsSelectorContract } from '@/lib/api/contracts/selectors/bigquery'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getScopesForService } from '@/lib/oauth/utils'
import { refreshAccessTokenIfNeeded, ServiceAccountTokenError } from '@/app/api/auth/oauth/utils'

const logger = createLogger('GoogleBigQueryDatasetsAPI')

export const dynamic = 'force-dynamic'

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

    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets?maxResults=200`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch BigQuery datasets', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch BigQuery datasets', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const datasets = (data.datasets || []).map(
      (ds: {
        datasetReference: { datasetId: string; projectId: string }
        friendlyName?: string
      }) => ({
        datasetReference: ds.datasetReference,
        friendlyName: ds.friendlyName,
      })
    )

    return NextResponse.json({ datasets })
  } catch (error) {
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
