import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  BITBUCKET_SELECTOR_PAGE_SIZE,
  bitbucketRepositoriesSelectorContract,
  bitbucketRepositoryProviderPageSchema,
  isBitbucketRepositoriesCursor,
} from '@/lib/api/contracts/selectors/bitbucket'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredential, refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'

export const dynamic = 'force-dynamic'

const logger = createLogger('BitbucketRepositoriesAPI')
const BITBUCKET_PROVIDER_ID = 'bitbucket'
const BITBUCKET_REPOSITORIES_URL = 'https://api.bitbucket.org/2.0/repositories'
const BITBUCKET_REPOSITORY_FIELDS = 'values.slug,values.uuid,values.name,values.full_name,next'
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
      { error: 'Bitbucket denied access to repository discovery.' },
      { status: 403 }
    )
  }
  if (status === 429) {
    return NextResponse.json(
      { error: 'Bitbucket rate-limited repository discovery. Try again shortly.' },
      { status: 429 }
    )
  }
  return NextResponse.json({ error: 'Bitbucket repository discovery failed.' }, { status: 502 })
}

/** Lists one workspace-scoped page for the `bitbucket.repositories` selector. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const caller = await checkSessionOrInternalAuth(request, { requireWorkflowId: true })
  if (!caller.success || !caller.userId) {
    return NextResponse.json({ error: caller.error || 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(
    bitbucketRepositoriesSelectorContract,
    request,
    {},
    {
      maxBodyBytes: SELECTOR_REQUEST_MAX_BYTES,
    }
  )
  if (!parsed.success) return parsed.response
  const { credential, workflowId, workspaceSlug, cursor } = parsed.data.body

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

  const firstPage = new URL(`${BITBUCKET_REPOSITORIES_URL}/${encodeURIComponent(workspaceSlug)}`)
  firstPage.searchParams.set('pagelen', String(BITBUCKET_SELECTOR_PAGE_SIZE))
  firstPage.searchParams.set('fields', BITBUCKET_REPOSITORY_FIELDS)
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
    logger.warn('Bitbucket repository request failed', {
      workspaceSlug,
      errorType: error instanceof Error ? error.name : 'unknown',
    })
    return NextResponse.json({ error: 'Bitbucket repository discovery failed.' }, { status: 502 })
  }

  if (!response.ok) return bitbucketFailureResponse(response.status)

  let providerBody: unknown
  try {
    providerBody = await readResponseJsonWithLimit(response, {
      label: 'Bitbucket repository response',
      maxBytes: PROVIDER_RESPONSE_MAX_BYTES,
      signal: request.signal,
    })
  } catch (error) {
    if (request.signal.aborted) throw error
    logger.warn('Bitbucket repository response was not bounded JSON', {
      workspaceSlug,
      errorType: error instanceof Error ? error.name : 'unknown',
    })
    return NextResponse.json(
      { error: 'Bitbucket returned an invalid repository response.' },
      { status: 502 }
    )
  }

  const expectedFullNamePrefix = workspaceSlug.toLowerCase()
  const page = bitbucketRepositoryProviderPageSchema.safeParse(providerBody)
  if (
    !page.success ||
    (page.data.next && !isBitbucketRepositoriesCursor(page.data.next, workspaceSlug)) ||
    page.data.values.some(
      (repository) => !repository.full_name.toLowerCase().startsWith(`${expectedFullNamePrefix}/`)
    )
  ) {
    logger.warn('Bitbucket returned a malformed repository page', { workspaceSlug })
    return NextResponse.json(
      { error: 'Bitbucket returned an invalid repository response.' },
      { status: 502 }
    )
  }

  return NextResponse.json({
    repositories: page.data.values.map((repository) => ({
      slug: repository.slug,
      uuid: repository.uuid,
      name: repository.name ?? repository.slug,
      fullName: repository.full_name,
    })),
    ...(page.data.next ? { nextCursor: page.data.next } : {}),
  })
})
