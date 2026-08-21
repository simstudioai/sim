import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import {
  HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS,
  type HarmonicSavedSearchesSelectorResponse,
  harmonicPeopleSavedSearchProviderSchema,
  harmonicSavedSearchesSelectorContract,
} from '@/lib/api/contracts/selectors/harmonic'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/token-service-accounts/descriptors'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { resolveCredentialAccessToken, resolveOAuthAccountId } from '@/lib/oauth/credential-service'

export const dynamic = 'force-dynamic'

const logger = createLogger('HarmonicSavedSearchesAPI')
const HARMONIC_SAVED_SEARCHES_URL = 'https://api.harmonic.ai/savedSearches'
const SELECTOR_REQUEST_MAX_BYTES = 8 * 1024
const PROVIDER_RESPONSE_MAX_BYTES = 1024 * 1024
const PROVIDER_RESPONSE_MAX_ROWS = 2_000
const PROVIDER_FETCH_TIMEOUT_MS = 10_000

type SavedSearchOption = HarmonicSavedSearchesSelectorResponse['savedSearches'][number]

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Harmonic selector request was cancelled', 'AbortError')
}

async function discardResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {})
}

async function providerFailureResponse(response: Response): Promise<NextResponse> {
  await discardResponseBody(response)
  if (response.status === 401 || response.status === 403) {
    return NextResponse.json(
      {
        error: 'Harmonic rejected this credential. Reconnect it and try again.',
        authRequired: true,
      },
      { status: 401 }
    )
  }
  if (response.status === 429) {
    return NextResponse.json(
      { error: 'Harmonic rate-limited saved-search discovery. Try again shortly.' },
      { status: 429 }
    )
  }
  if (response.status >= 400 && response.status < 500) {
    return NextResponse.json(
      { error: 'Harmonic could not list saved searches for this request.' },
      { status: 400 }
    )
  }
  return NextResponse.json({ error: 'Harmonic saved-search discovery failed.' }, { status: 502 })
}

function credentialFailureResponse(error?: unknown): NextResponse {
  if (
    error instanceof TokenServiceAccountValidationError &&
    error.code === 'provider_unavailable'
  ) {
    return NextResponse.json(
      { error: 'The Harmonic credential service is temporarily unavailable.' },
      { status: 502 }
    )
  }
  return NextResponse.json(
    {
      error: 'Could not resolve the Harmonic credential. Reconnect it and try again.',
      authRequired: true,
    },
    { status: 401 }
  )
}

function normalizeSavedSearches(value: unknown): SavedSearchOption[] {
  if (!Array.isArray(value) || value.length > PROVIDER_RESPONSE_MAX_ROWS) {
    throw new Error('Harmonic returned an invalid saved-search collection')
  }

  const byUrn = new Map<string, SavedSearchOption>()
  const urnById = new Map<string, string>()
  for (const item of value) {
    if (!isPlainRecord(item)) {
      throw new Error('Harmonic returned a malformed saved-search entry')
    }
    if (item.type !== 'PERSONS') continue

    const parsed = harmonicPeopleSavedSearchProviderSchema.safeParse(item)
    if (!parsed.success) {
      throw new Error('Harmonic returned a malformed people saved search')
    }
    const option = {
      id: String(parsed.data.id),
      urn: parsed.data.entity_urn,
      name: parsed.data.name,
    }
    const existingByUrn = byUrn.get(option.urn)
    const existingUrnForId = urnById.get(option.id)
    if (
      (existingByUrn && (existingByUrn.id !== option.id || existingByUrn.name !== option.name)) ||
      (existingUrnForId && existingUrnForId !== option.urn)
    ) {
      throw new Error('Harmonic returned conflicting saved-search identities')
    }
    if (existingByUrn) continue
    if (byUrn.size >= HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS) {
      /**
       * `GET /savedSearches` is unpaginated, so this ceiling bounds customer data
       * rather than a provider catalog. Every sibling selector with a data-driven
       * bound truncates and warns; failing here would leave the dropdown dead with
       * no in-place recovery.
       */
      logger.warn('Harmonic saved-search list hit the option ceiling; list may be incomplete', {
        cap: HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS,
      })
      break
    }
    byUrn.set(option.urn, option)
    urnById.set(option.id, option.urn)
  }

  return [...byUrn.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.urn.localeCompare(right.urn)
  )
}

/**
 * Lists the bounded people saved searches used by `harmonic.savedSearches`.
 * This editor/executor selector follows the established Bitbucket and NetSuite
 * selector route pattern: surface authentication happens first, then the
 * shared workflow-scoped credential authorization helper runs before provider
 * metadata, secret resolution, or external egress.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const caller = await checkSessionOrInternalAuth(request, { requireWorkflowId: true })
  if (!caller.success || !caller.userId) {
    return NextResponse.json({ error: caller.error || 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(
    harmonicSavedSearchesSelectorContract,
    request,
    {},
    { maxBodyBytes: SELECTOR_REQUEST_MAX_BYTES }
  )
  if (!parsed.success) return parsed.response
  const { credential, workflowId } = parsed.data.body

  const authorization = await authorizeCredentialUse(request, {
    credentialId: credential,
    workflowId,
    callerUserId: caller.userId,
  })
  if (!authorization.ok || !authorization.credentialOwnerUserId) {
    return NextResponse.json({ error: authorization.error || 'Unauthorized' }, { status: 403 })
  }

  const resolvedCredentialId = authorization.resolvedCredentialId ?? credential
  const credentialMetadata = await resolveOAuthAccountId(resolvedCredentialId)
  if (
    authorization.credentialType !== 'service_account' ||
    credentialMetadata?.credentialType !== 'service_account' ||
    credentialMetadata.providerId !== HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    return NextResponse.json({ error: 'Select a Harmonic API-key account.' }, { status: 400 })
  }

  throwIfAborted(request.signal)
  let token
  try {
    token = await resolveCredentialAccessToken(
      resolvedCredentialId,
      authorization.credentialOwnerUserId,
      requestId
    )
  } catch (error) {
    throwIfAborted(request.signal)
    logger.warn('Failed to resolve Harmonic selector credential', {
      credentialId: resolvedCredentialId,
      errorType: error instanceof Error ? error.name : 'unknown',
    })
    if (error instanceof TokenServiceAccountValidationError) {
      return credentialFailureResponse(error)
    }
    throw error
  }
  throwIfAborted(request.signal)
  if (!token?.accessToken) return credentialFailureResponse()

  const timeoutSignal = AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS)
  const providerSignal = AbortSignal.any([request.signal, timeoutSignal])
  let response: Response
  try {
    response = await fetch(HARMONIC_SAVED_SEARCHES_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', apikey: token.accessToken },
      redirect: 'error',
      signal: providerSignal,
    })
  } catch (error) {
    if (request.signal.aborted) throw error
    if (timeoutSignal.aborted || (error instanceof DOMException && error.name === 'TimeoutError')) {
      return NextResponse.json(
        { error: 'Harmonic saved-search discovery timed out.' },
        { status: 504 }
      )
    }
    logger.warn('Harmonic saved-search request failed', {
      errorType: error instanceof Error ? error.name : 'unknown',
    })
    return NextResponse.json({ error: 'Harmonic saved-search discovery failed.' }, { status: 502 })
  }

  if (!response.ok) return providerFailureResponse(response)

  try {
    const providerBody = await readResponseJsonWithLimit(response, {
      label: 'Harmonic saved-search response',
      maxBytes: PROVIDER_RESPONSE_MAX_BYTES,
      signal: providerSignal,
    })
    throwIfAborted(providerSignal)
    return NextResponse.json({ savedSearches: normalizeSavedSearches(providerBody) })
  } catch (error) {
    if (request.signal.aborted) throw error
    if (timeoutSignal.aborted || (error instanceof DOMException && error.name === 'TimeoutError')) {
      return NextResponse.json(
        { error: 'Harmonic saved-search discovery timed out.' },
        { status: 504 }
      )
    }
    logger.warn('Harmonic saved-search response was invalid', {
      errorType: error instanceof Error ? error.name : 'unknown',
    })
    return NextResponse.json(
      { error: 'Harmonic returned an invalid saved-search response.' },
      { status: 502 }
    )
  }
})
