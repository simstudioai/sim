import { db } from '@sim/db'
import { verification } from '@sim/db/schema'
import { and, eq, gt } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { oauthAuthorizeParamsContract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/**
 * Returns the original OAuth authorize parameters stored in the verification record
 * for a given consent code. Used by the consent page to reconstruct the authorize URL
 * when switching accounts.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(oauthAuthorizeParamsContract, request, {})
  if (!parsed.success) return parsed.response
  const consentCode = parsed.data.query.consent_code

  const [record] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(and(eq(verification.identifier, consentCode), gt(verification.expiresAt, new Date())))
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
})
