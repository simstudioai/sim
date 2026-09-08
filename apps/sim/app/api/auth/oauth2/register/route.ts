import { toNextJsHandler } from 'better-auth/next-js'
import { type NextRequest, NextResponse } from 'next/server'
import { registerSearchOAuthClientContract } from '@/lib/api/contracts/oauth-provider'
import { parseRequest } from '@/lib/api/server'
import { auth } from '@/lib/auth'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const { POST: register } = toNextJsHandler(auth.handler)
const HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' } as const

function invalidMetadata(description: string, status = 400) {
  return NextResponse.json(
    { error: 'invalid_client_metadata', error_description: description },
    { status, headers: HEADERS }
  )
}

/** RFC 7591 public registration delegates persistence to Sim's OAuth provider. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  if (isAuthDisabled) {
    return NextResponse.json(
      { error: 'OAuth provider is not enabled' },
      { status: 404, headers: HEADERS }
    )
  }
  const limited = await enforceIpRateLimit('oauth-provider-register', request, {
    maxTokens: 20,
    refillRate: 20,
    refillIntervalMs: 60_000,
  })
  if (limited) return limited
  if (request.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/json') {
    return invalidMetadata('Client metadata must be sent as application/json.', 415)
  }
  const parsed = await parseRequest(
    registerSearchOAuthClientContract,
    request,
    {},
    {
      maxBodyBytes: 32 * 1024,
      validationErrorResponse: (error) =>
        invalidMetadata(error.issues[0]?.message ?? 'Invalid client metadata.'),
      invalidJsonResponse: () => invalidMetadata('Client metadata must be valid JSON.'),
      payloadTooLargeResponse: () => invalidMetadata('Client metadata is too large.', 413),
    }
  )
  if (!parsed.success) return parsed.response

  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const name of ['x-forwarded-for', 'x-real-ip']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  /** Public clients never inherit an ambient browser session or client-management privileges. */
  const response = await register(
    new Request(`${getBaseUrl()}/api/auth/oauth2/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...parsed.data.body, require_pkce: true }),
    })
  )
  if (!response.ok) return response
  const body = registerSearchOAuthClientContract.response.schema.parse(await response.json())
  return NextResponse.json(body, { status: 201, headers: HEADERS })
})
