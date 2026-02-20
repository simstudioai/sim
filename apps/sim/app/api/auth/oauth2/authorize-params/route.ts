import { db } from '@sim/db'
import { verification } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

/**
 * Returns the original OAuth authorize parameters stored in the verification record
 * for a given consent code. Used by the consent page to reconstruct the authorize URL
 * when switching accounts.
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const consentCode = request.nextUrl.searchParams.get('consent_code')
  if (!consentCode) {
    return NextResponse.json({ error: 'consent_code is required' }, { status: 400 })
  }

  const [record] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.identifier, consentCode))
    .limit(1)

  if (!record) {
    return NextResponse.json({ error: 'Invalid or expired consent code' }, { status: 404 })
  }

  const data = JSON.parse(record.value) as {
    clientId: string
    redirectURI: string
    scope: string[]
    userId: string
    codeChallenge: string
    codeChallengeMethod: string
    state: string | null
    nonce: string | null
  }

  if (data.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    client_id: data.clientId,
    redirect_uri: data.redirectURI,
    scope: data.scope.join(' '),
    code_challenge: data.codeChallenge,
    code_challenge_method: data.codeChallengeMethod,
    state: data.state,
    nonce: data.nonce,
    response_type: 'code',
  })
}
