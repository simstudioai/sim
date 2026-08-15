import { NextResponse } from 'next/server'

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
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
