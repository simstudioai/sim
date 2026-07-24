import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { piExaSearchContract } from '@/lib/api/contracts/pi-exa-search'
import { parseRequest } from '@/lib/api/server'
import { resolveBYOKKeyById } from '@/lib/api-key/byok'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authenticatePiSearchCapability,
  isPiSearchLeaseCurrent,
  queryContainsProtectedSecret,
  releasePiSearchCall,
  reservePiSearchCall,
  settlePiSearchCall,
} from '@/lib/pi/exa-search/capabilities'
import { scrubPiSecrets } from '@/executor/handlers/pi/redaction'
import { executePiExaSearch } from '@/tools/exa/search-client'

const logger = createLogger('PiExaSearchBroker')
const MAX_BODY_BYTES = 4 * 1024
const SEARCH_TIMEOUT_MS = 30_000
const CREDENTIAL_PREFIX_PATTERN =
  /\b(?:sk-(?:proj|ant)-|gsk_|github_pat_|gh[pousr]_|xai-|AIza|AKIA|exa[_-])[A-Za-z0-9_-]{12,}\b/

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const token = bearerToken(request)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const capability = await authenticatePiSearchCapability(token)
  if (!capability) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(
    piExaSearchContract,
    request,
    {},
    {
      maxBodyBytes: MAX_BODY_BYTES,
    }
  )
  if (!parsed.success) return parsed.response
  const { query, numResults } = parsed.data.body

  if (
    query.includes(token) ||
    queryContainsProtectedSecret(query, capability.secretFingerprints) ||
    CREDENTIAL_PREFIX_PATTERN.test(query)
  ) {
    return NextResponse.json(
      { error: 'Search query contains protected credential material' },
      {
        status: 400,
      }
    )
  }

  const lease = await reservePiSearchCall(capability)
  if (!lease) {
    return NextResponse.json(
      { error: 'Search budget is exhausted or another search is running' },
      {
        status: 429,
      }
    )
  }

  let settled = false
  let exaKey: string | undefined
  try {
    const byok = await resolveBYOKKeyById(capability.workspaceId, 'exa', capability.providerKeyId)
    if (byok.status === 'missing') {
      return NextResponse.json(
        { error: 'Exa BYOK key is no longer configured for this workspace' },
        { status: 412 }
      )
    }
    if (byok.status === 'infrastructure_error') {
      logger.error('Failed to resolve Exa BYOK key', {
        capabilityId: capability.id,
        error: byok.error.message,
      })
      return NextResponse.json({ error: 'Unable to load the workspace Exa key' }, { status: 503 })
    }
    exaKey = byok.value.apiKey
    if (query.includes(byok.value.apiKey)) {
      return NextResponse.json(
        { error: 'Search query contains protected credential material' },
        { status: 400 }
      )
    }

    const remainingLeaseMs = lease.expiresAt.getTime() - Date.now() - 1_000
    if (remainingLeaseMs <= 0 || !(await isPiSearchLeaseCurrent(lease))) {
      return NextResponse.json({ error: 'Search lease expired' }, { status: 409 })
    }
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(Math.min(SEARCH_TIMEOUT_MS, remainingLeaseMs)),
    ])
    const result = await executePiExaSearch({
      apiKey: byok.value.apiKey,
      query,
      numResults,
      signal,
    })
    const serialized = JSON.stringify(result)
    if (
      serialized.includes(byok.value.apiKey) ||
      serialized.includes(token) ||
      CREDENTIAL_PREFIX_PATTERN.test(serialized) ||
      queryContainsProtectedSecret(serialized, capability.secretFingerprints)
    ) {
      throw new Error('Exa search returned protected credential material')
    }
    settled = await settlePiSearchCall(lease, Buffer.byteLength(serialized))
    if (!settled) {
      throw new Error('Search lease expired before the result was settled')
    }
    return NextResponse.json(result)
  } catch (error) {
    const message = scrubPiSecrets(
      getErrorMessage(error, 'Exa search failed'),
      [token, exaKey].filter((value): value is string => Boolean(value))
    )
    logger.warn('Pi Exa search failed', { capabilityId: capability.id, error: message })
    return NextResponse.json({ error: 'Exa search failed' }, { status: 502 })
  } finally {
    if (!settled) await releasePiSearchCall(lease).catch(() => {})
  }
})
