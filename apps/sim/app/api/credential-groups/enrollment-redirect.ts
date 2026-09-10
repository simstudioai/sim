import { NextResponse } from 'next/server'
import type { CredentialGroupOAuthFailure } from '@/lib/credential-groups/oauth-completion'

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

export function createCredentialGroupCompletionRedirect(
  oauth?: CredentialGroupOAuthFailure,
  completionId?: string
): NextResponse {
  const query = new URLSearchParams()
  if (oauth) query.set('oauth', oauth)
  if (completionId) query.set('completionId', completionId)
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: `/credential-groups/complete${query.size ? `?${query}` : ''}`,
      ...NO_STORE_REDIRECT_HEADERS,
    },
  })
}
