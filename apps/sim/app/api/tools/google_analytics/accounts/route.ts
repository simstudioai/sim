import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { googleAnalyticsAccountsSelectorContract } from '@/lib/api/contracts/selectors/google-analytics'
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

const logger = createLogger('GoogleAnalyticsAccountsAPI')

export const dynamic = 'force-dynamic'

/** Provider error bodies are echoed into logs and the response, so cap what we read. */
const MAX_ERROR_BODY_BYTES = 32 * 1024

const MAX_ACCOUNT_PAGES = 10
const ACCOUNT_PAGE_SIZE = 200

interface AnalyticsAccount {
  name?: string
  displayName?: string
}

interface AccountsResponse {
  accounts?: AnalyticsAccount[]
  nextPageToken?: string
}

/**
 * POST /api/tools/google_analytics/accounts
 *
 * Lists the Google Analytics accounts the caller can administer, for the account
 * picker behind the List Properties operation.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(
      googleAnalyticsAccountsSelectorContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          const path = error.issues.at(0)?.path[0]
          const message =
            path === 'credential'
              ? 'Credential is required'
              : getValidationErrorMessage(error, 'Invalid request')
          logger.error(`Validation failed for Google Analytics accounts request: ${message}`)
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

    const { items, truncated } = await drainGooglePagedList<AnalyticsAccount, AccountsResponse>({
      buildUrl: (pageToken) => {
        const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accounts')
        url.searchParams.set('pageSize', String(ACCOUNT_PAGE_SIZE))
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
              label: 'Google Analytics accounts error',
            })
          )
        } catch {
          // An oversized or unparseable provider error must not be materialized into
          // the log and the response body; the status alone is still actionable.
          return { error: `Provider returned status ${response.status}` }
        }
      },
      getItems: (body) => body.accounts,
      getNextPageToken: (body) => body.nextPageToken,
      maxPages: MAX_ACCOUNT_PAGES,
      label: 'Google Analytics accounts',
    })

    const accounts = items.flatMap((account) =>
      account.name ? [{ name: account.name, displayName: account.displayName }] : []
    )

    if (truncated) {
      logger.warn('Hit the Google Analytics pagination cap; the accounts picker is incomplete', {
        returned: accounts.length,
      })
    }

    return NextResponse.json({ accounts, truncated })
  } catch (error) {
    if (error instanceof GooglePageError) {
      logger.error('Failed to fetch Google Analytics accounts', {
        status: error.status,
        error: error.body,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Google Analytics accounts', details: error.body },
        { status: error.status }
      )
    }
    if (error instanceof ServiceAccountTokenError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('Error processing Google Analytics accounts request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Google Analytics accounts', details: (error as Error).message },
      { status: 500 }
    )
  }
})
