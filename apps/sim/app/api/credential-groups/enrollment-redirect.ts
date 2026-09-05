import { NextResponse } from 'next/server'

const NO_STORE_REDIRECT_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const

export function createCredentialGroupEnrollmentRedirect(
  token: string,
  params: Record<string, string>
): NextResponse {
  const query = new URLSearchParams(params).toString()
  const location = `/credential-groups/enroll/${encodeURIComponent(token)}${query ? `?${query}` : ''}`
  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: location,
      ...NO_STORE_REDIRECT_HEADERS,
    },
  })
}

export type CredentialGroupOAuthFailure =
  | 'denied'
  | 'account_mismatch'
  | 'permissions_required'
  | 'configuration_changed'
  | 'rate_limited'
  | 'unavailable'
  | 'failed'

export function createCredentialGroupCompletionRedirect(
  oauth?: CredentialGroupOAuthFailure
): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: `/credential-groups/complete${oauth ? `?oauth=${oauth}` : ''}`,
      ...NO_STORE_REDIRECT_HEADERS,
    },
  })
}
