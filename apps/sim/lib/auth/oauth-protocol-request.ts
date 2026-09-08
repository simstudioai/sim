import { truncate } from '@sim/utils/string'
import { NextRequest, NextResponse } from 'next/server'
import type { OAuthClientCredentials, OAuthProtocolErrorCode } from '@/lib/auth/oauth-token-family'

export interface ParsedOAuthForm {
  form: URLSearchParams
  credentials: OAuthClientCredentials | null
  rawBody: string
}

const MAX_OAUTH_FORM_BYTES = 16_384
const PKCE_CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/
const PKCE_S256_CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type OAuthFormParseResult =
  | { success: true; value: ParsedOAuthForm }
  | { success: false; response: NextResponse }

export function oauthErrorResponse(
  error:
    | OAuthProtocolErrorCode
    | 'invalid_request'
    | 'invalid_token'
    | 'insufficient_scope'
    | 'server_error'
    | 'unsupported_grant_type'
    | 'unsupported_response_type',
  description: string,
  status = 400,
  challenge = false
): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        ...(challenge && { 'WWW-Authenticate': 'Basic realm="oauth2"' }),
      },
    }
  )
}

/** Formats an OAuth protocol error without exposing credentials or token lookup details. */
export function oauthProtocolErrorResponse(
  error: OAuthProtocolErrorCode,
  description: string,
  method: OAuthClientCredentials['method']
): NextResponse {
  const basicFailure = error === 'invalid_client' && method === 'client_secret_basic'
  return oauthErrorResponse(error, description, basicFailure ? 401 : 400, basicFailure)
}

const DELEGATED_INVALID_GRANT_DESCRIPTIONS = new Set([
  'PKCE is required for this client',
  'code_verifier required because PKCE was used in authorization',
  'code_verifier provided but PKCE was not used in authorization',
  'code verification failed',
  'Either code_verifier or client_secret is required',
  'invalid client_id',
  'redirect_uri mismatch',
  'missing user, user may have been deleted',
  'session no longer exists',
])

/** Enforces RFC 7636 syntax before Better Auth stores an authorization request. */
export function validateOAuthPkceAuthorizationRequest(
  searchParams: URLSearchParams
): string | null {
  const hasChallenge = searchParams.has('code_challenge')
  const hasMethod = searchParams.has('code_challenge_method')
  if (hasChallenge !== hasMethod) {
    return 'code_challenge and code_challenge_method must both be provided.'
  }
  if (!hasChallenge) return null

  if (searchParams.get('code_challenge_method') !== 'S256') {
    return 'Only the S256 code challenge method is supported.'
  }
  const challenge = searchParams.get('code_challenge') ?? ''
  if (!PKCE_S256_CODE_CHALLENGE_PATTERN.test(challenge)) {
    return 'Code challenge is invalid.'
  }
  return null
}

/** Whether a token request carries an RFC 7636 code verifier. */
export function isValidOAuthCodeVerifier(value: string): boolean {
  return PKCE_CODE_VERIFIER_PATTERN.test(value)
}

const DELEGATED_OAUTH_ERROR_CODES = new Set([
  'invalid_client',
  'invalid_grant',
  'invalid_request',
  'invalid_scope',
  'unauthorized_client',
  'unsupported_grant_type',
])

/** Normalizes Better Auth 1.6 token errors to RFC 6749 and RFC 7636 semantics. */
export async function normalizeDelegatedOAuthTokenResponse(
  response: Response,
  method: OAuthClientCredentials['method']
): Promise<NextResponse> {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('Pragma', 'no-cache')
  headers.delete('content-length')
  if (response.ok) {
    return new NextResponse(response.body, { status: response.status, headers })
  }

  if (response.status >= 500) {
    headers.set('content-type', 'application/json')
    return new NextResponse(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Token exchange failed.',
      }),
      { status: response.status, headers }
    )
  }

  let payload: Record<string, unknown> | null = null
  try {
    const parsed = JSON.parse(await response.text()) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>
    }
  } catch {}

  const delegatedDescription = payload?.error_description
  const error =
    typeof delegatedDescription === 'string' &&
    DELEGATED_INVALID_GRANT_DESCRIPTIONS.has(delegatedDescription)
      ? 'invalid_grant'
      : typeof payload?.error === 'string' && DELEGATED_OAUTH_ERROR_CODES.has(payload.error)
        ? payload.error
        : 'invalid_request'
  const errorDescription =
    typeof payload?.error_description === 'string'
      ? truncate(payload.error_description, 512)
      : 'Token request is invalid.'
  const status = error === 'invalid_client' && method === 'client_secret_basic' ? 401 : 400
  if (status === 401) headers.set('WWW-Authenticate', 'Basic realm="oauth2"')
  else headers.delete('www-authenticate')
  headers.set('content-type', 'application/json')

  return new NextResponse(JSON.stringify({ error, error_description: errorDescription }), {
    status,
    headers,
  })
}

/** A successful RFC 7009 response intentionally has no body. */
export function oauthRevocationSuccessResponse(): NextResponse {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  })
}

function parseBasicCredentials(authorization: string): OAuthClientCredentials | null {
  const match = /^Basic[ ]+([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)
  if (!match?.[1]) return null

  let decoded: string
  try {
    const encoded = match[1]
    const bytes = Buffer.from(encoded, 'base64')
    const canonicalInput = encoded.replace(/=+$/, '')
    const canonicalDecoded = bytes.toString('base64').replace(/=+$/, '')
    if (canonicalInput !== canonicalDecoded) return null
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  const separator = decoded.indexOf(':')
  if (separator < 1 || separator === decoded.length - 1) return null

  try {
    const clientId = decodeURIComponent(decoded.slice(0, separator).replace(/\+/g, ' '))
    const clientSecret = decodeURIComponent(decoded.slice(separator + 1).replace(/\+/g, ' '))
    if (!clientId || !clientSecret) return null
    return { clientId, clientSecret, method: 'client_secret_basic' }
  } catch {
    return null
  }
}

type OAuthBodyReadResult =
  | { success: true; body: string }
  | { success: false; reason: 'invalid_encoding' | 'too_large' }

async function readBoundedOAuthBody(request: Request): Promise<OAuthBodyReadResult> {
  if (!request.body) return { success: true, body: '' }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_OAUTH_FORM_BYTES) {
        await reader.cancel()
        return { success: false, reason: 'too_large' }
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { success: true, body: new TextDecoder('utf-8', { fatal: true }).decode(body) }
  } catch {
    return { success: false, reason: 'invalid_encoding' }
  }
}

/**
 * Rebuilds the consumed request for Better Auth 1.6.
 * Its Basic parser omits RFC 6749 form-decoding, so already-authenticated Basic
 * credentials are passed through its body path using their decoded values.
 */
export function buildDelegatedOAuthRequest(
  request: NextRequest,
  parsed: ParsedOAuthForm
): NextRequest {
  const headers = new Headers(request.headers)
  let body = parsed.rawBody
  if (parsed.credentials?.method === 'client_secret_basic') {
    const form = new URLSearchParams(parsed.rawBody)
    form.set('client_id', parsed.credentials.clientId)
    form.set('client_secret', parsed.credentials.clientSecret ?? '')
    body = form.toString()
    headers.delete('authorization')
  }
  headers.delete('content-length')
  return new NextRequest(request.url, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  })
}

/**
 * Parses a form-encoded OAuth request once and rejects parameter ambiguity.
 * The bounded raw body is retained so delegated Better Auth grants can receive
 * an equivalent request after this function consumes the original stream.
 */
export async function parseOAuthFormRequest(request: NextRequest): Promise<OAuthFormParseResult> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/x-www-form-urlencoded') {
    return {
      success: false,
      response: oauthErrorResponse(
        'invalid_request',
        'Content-Type must be application/x-www-form-urlencoded.'
      ),
    }
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OAUTH_FORM_BYTES) {
    return {
      success: false,
      response: oauthErrorResponse('invalid_request', 'OAuth request body is too large.'),
    }
  }
  const bodyResult = await readBoundedOAuthBody(request)
  if (!bodyResult.success) {
    return {
      success: false,
      response: oauthErrorResponse(
        'invalid_request',
        bodyResult.reason === 'too_large'
          ? 'OAuth request body is too large.'
          : 'OAuth request body must be valid UTF-8.'
      ),
    }
  }
  const body = bodyResult.body
  const form = new URLSearchParams(body)
  const seen = new Set<string>()
  for (const [name] of form) {
    if (seen.has(name)) {
      return {
        success: false,
        response: oauthErrorResponse(
          'invalid_request',
          `OAuth parameter ${name} appears more than once.`
        ),
      }
    }
    seen.add(name)
  }

  const authorization = request.headers.get('authorization')
  if (authorization) {
    const basic = parseBasicCredentials(authorization)
    if (!basic) {
      return {
        success: false,
        response: oauthErrorResponse(
          'invalid_client',
          'Authorization header is invalid.',
          401,
          true
        ),
      }
    }
    if (form.has('client_secret')) {
      return {
        success: false,
        response: oauthErrorResponse(
          'invalid_request',
          'Use exactly one client authentication method.'
        ),
      }
    }
    return { success: true, value: { form, credentials: basic, rawBody: body } }
  }

  const clientId = form.get('client_id')
  if (!clientId) return { success: true, value: { form, credentials: null, rawBody: body } }
  const clientSecret = form.get('client_secret')
  return {
    success: true,
    value: {
      form,
      rawBody: body,
      credentials: clientSecret
        ? { clientId, clientSecret, method: 'client_secret_post' }
        : { clientId, method: 'none' },
    },
  }
}

/** Reads an optional OAuth scope parameter as a de-duplicated ordered list. */
export function parseRequestedScopes(form: URLSearchParams): string[] | undefined {
  const scope = form.get('scope')?.trim()
  if (!scope) return undefined
  return [...new Set(scope.split(/\s+/))]
}

export function missingOAuthParameterResponse(name: string): NextResponse {
  return oauthErrorResponse('invalid_request', `Missing required OAuth parameter ${name}.`)
}

export function unsupportedGrantResponse(grantType: string): NextResponse {
  return oauthErrorResponse('unsupported_grant_type', `Unsupported grant type ${grantType}.`)
}
