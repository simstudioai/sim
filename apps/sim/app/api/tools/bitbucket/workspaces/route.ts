import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  BITBUCKET_SELECTOR_PAGE_SIZE,
  bitbucketWorkspaceProviderPageSchema,
  bitbucketWorkspacesSelectorContract,
  isBitbucketWorkspacesCursor,
} from '@/lib/api/contracts/selectors/bitbucket'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredential, refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'

export const dynamic = 'force-dynamic'

const logger = createLogger('BitbucketWorkspacesAPI')
const BITBUCKET_PROVIDER_ID = 'bitbucket'
const BITBUCKET_WORKSPACES_URL = 'https://api.bitbucket.org/2.0/user/workspaces'
const BITBUCKET_WORKSPACE_FIELDS =
  'values.administrator,values.workspace.slug,values.workspace.uuid,values.workspace.name,next'
const SELECTOR_REQUEST_MAX_BYTES = 8 * 1024
const PROVIDER_RESPONSE_MAX_BYTES = 1024 * 1024

function bitbucketFailureResponse(status: number): NextResponse {
  if (status === 401) {
    return NextResponse.json(
      {
        error: 'Bitbucket rejected this credential. Reconnect it and try again.',
        authRequired: true,
      },
      { status: 401 }
    )
  }
  if (status === 403) {
    return NextResponse.json(
      { error: 'Bitbucket denied access to workspace discovery.' },
      { status: 403 }
    )
  }
  if (status === 429) {
    return NextResponse.json(
      { error: 'Bitbucket rate-limited workspace discovery. Try again shortly.' },
      { status: 429 }
    )
  }
  return NextResponse.json({ error: 'Bitbucket workspace discovery failed.' }, { status: 502 })
}

/** Lists one normalized page for the `bitbucket.workspaces` selector. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const caller = await checkSessionOrInternalAuth(request, { requireWorkflowId: true })
  if (!caller.success || !caller.userId) {
    return NextResponse.json({ error: caller.error || 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(
    bitbucketWorkspacesSelectorContract,
    request,
    {},
    {
      maxBodyBytes: SELECTOR_REQUEST_MAX_BYTES,
    }
  )
  if (!parsed.success) return parsed.response
  const { credential, workflowId, cursor } = parsed.data.body

  const authorization = await authorizeCredentialUse(request, {
    credentialId: credential,
    workflowId,
    callerUserId: caller.userId,
  })
  if (!authorization.ok || !authorization.credentialOwnerUserId) {
    return NextResponse.json({ error: authorization.error || 'Unauthorized' }, { status: 403 })
  }

  const resolvedCredentialId = authorization.resolvedCredentialId ?? credential
  const storedCredential = await getCredential(
    requestId,
    resolvedCredentialId,
    authorization.credentialOwnerUserId
  )
  if (!storedCredential || storedCredential.providerId !== BITBUCKET_PROVIDER_ID) {
    return NextResponse.json({ error: 'Select a Bitbucket OAuth credential.' }, { status: 400 })
  }

  const accessToken = await refreshAccessTokenIfNeeded(
    resolvedCredentialId,
    authorization.credentialOwnerUserId,
    requestId
  )
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Could not retrieve a Bitbucket access token.', authRequired: true },
      { status: 401 }
    )
  }

  const firstPage = new URL(BITBUCKET_WORKSPACES_URL)
  firstPage.searchParams.set('pagelen', String(BITBUCKET_SELECTOR_PAGE_SIZE))
  firstPage.searchParams.set('fields', BITBUCKET_WORKSPACE_FIELDS)
  const providerUrl = cursor ?? firstPage.toString()

  let response: Response
  try {
    response = await fetch(providerUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      redirect: 'error',
      signal: request.signal,
    })
  } catch (error) {
    if (request.signal.aborted) throw error
    logger.warn('Bitbucket workspace request failed', {
      errorType: error instanceof Error ? error.name : 'unknown',
    })
    return NextResponse.json({ error: 'Bitbucket workspace discovery failed.' }, { status: 502 })
  }

  if (!response.ok) return bitbucketFailureResponse(response.status)

  let providerBody: unknown
  try {
    providerBody = await readResponseJsonWithLimit(response, {
      label: 'Bitbucket workspace response',
      maxBytes: PROVIDER_RESPONSE_MAX_BYTES,
      signal: request.signal,
    })
  } catch (error) {
    if (request.signal.aborted) throw error
    logger.warn('Bitbucket workspace response was not bounded JSON', {
      errorType: error instanceof Error ? error.name : 'unknown',
    })
    return NextResponse.json(
      { error: 'Bitbucket returned an invalid workspace response.' },
      { status: 502 }
    )
  }

  const page = bitbucketWorkspaceProviderPageSchema.safeParse(providerBody)
  if (!page.success || (page.data.next && !isBitbucketWorkspacesCursor(page.data.next))) {
    logger.warn('Bitbucket returned a malformed workspace page')
    return NextResponse.json(
      { error: 'Bitbucket returned an invalid workspace response.' },
      { status: 502 }
    )
  }

  return NextResponse.json({
    workspaces: page.data.values.map(({ administrator, workspace }) => ({
      slug: workspace.slug,
      uuid: workspace.uuid,
      name: workspace.name ?? workspace.slug,
      administrator,
    })),
    ...(page.data.next ? { nextCursor: page.data.next } : {}),
  })
})
