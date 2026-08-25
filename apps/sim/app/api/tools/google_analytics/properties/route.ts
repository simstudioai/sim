import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { googleAnalyticsPropertiesSelectorContract } from '@/lib/api/contracts/selectors/google-analytics'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  refreshAccessTokenIfNeeded,
  ServiceAccountTokenError,
} from '@/lib/oauth/credential-service'
import { drainGooglePagedList, GooglePageError } from '@/lib/oauth/google-pagination'
import { getScopesForService } from '@/lib/oauth/utils'

const logger = createLogger('GoogleAnalyticsPropertiesAPI')

export const dynamic = 'force-dynamic'

/** Provider error bodies are echoed into logs and the response, so cap what we read. */
const MAX_ERROR_BODY_BYTES = 32 * 1024

const MAX_ACCOUNT_SUMMARY_PAGES = 10
const ACCOUNT_SUMMARY_PAGE_SIZE = 200

interface AccountSummary {
  account?: string
  displayName?: string
  propertySummaries?: Array<{ property?: string; displayName?: string }>
}

interface AccountSummariesResponse {
  accountSummaries?: AccountSummary[]
  nextPageToken?: string
}

/**
 * POST /api/tools/google_analytics/properties
 *
 * Lists every GA4 property the caller can reach, flattened out of the Admin API's
 * account summaries so one request covers all accounts. Each entry carries its
 * owning account's display name so properties that share a name stay distinguishable.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(
      googleAnalyticsPropertiesSelectorContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          const path = error.issues.at(0)?.path[0]
          const message =
            path === 'credential'
              ? 'Credential is required'
              : getValidationErrorMessage(error, 'Invalid request')
          logger.error(`Validation failed for Google Analytics properties request: ${message}`)
          return NextResponse.json({ error: message }, { status: 400 })
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { credential, workflowId, impersonateEmail } = parsed.data.body

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
      getScopesForService('google-analytics'),
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

    const { items, truncated } = await drainGooglePagedList<
      AccountSummary,
      AccountSummariesResponse
    >({
      buildUrl: (pageToken) => {
        const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries')
        url.searchParams.set('pageSize', String(ACCOUNT_SUMMARY_PAGE_SIZE))
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
      parseError: async (response) => {
        try {
          return JSON.parse(
            await readResponseTextWithLimit(response, {
              maxBytes: MAX_ERROR_BODY_BYTES,
              label: 'Google Analytics account summaries error',
            })
          )
        } catch {
          // An oversized or unparseable provider error must not be materialized into
          // the log and the response body; the status alone is still actionable.
          return { error: `Provider returned status ${response.status}` }
        }
      },
      getItems: (body) => body.accountSummaries,
      getNextPageToken: (body) => body.nextPageToken,
      maxPages: MAX_ACCOUNT_SUMMARY_PAGES,
      label: 'Google Analytics account summaries',
    })

    const properties = items.flatMap((summary) =>
      (summary.propertySummaries ?? []).flatMap((property) =>
        property.property
          ? [
              {
                property: property.property,
                displayName: property.displayName,
                accountDisplayName: summary.displayName,
              },
            ]
          : []
      )
    )

    if (truncated) {
      logger.warn('Hit the Google Analytics pagination cap; the properties picker is incomplete', {
        returned: properties.length,
      })
    }

    return NextResponse.json({ properties, truncated })
  } catch (error) {
    if (error instanceof GooglePageError) {
      logger.error('Failed to fetch Google Analytics properties', {
        status: error.status,
        error: error.body,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Google Analytics properties', details: error.body },
        { status: error.status }
      )
    }
    if (error instanceof ServiceAccountTokenError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('Error processing Google Analytics properties request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Google Analytics properties',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
})
