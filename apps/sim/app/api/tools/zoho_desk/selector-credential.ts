import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { resolveCredentialAccessToken, resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import { extractZohoDeskBaseFromScope } from '@/tools/zoho_desk/host-allowlist'
import { getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

const logger = createLogger('ZohoDeskSelectorCredential')

interface ResolvedZohoDeskCredential {
  accessToken: string
  /** Desk REST base including the `/api/v1` suffix, anchored to the Zoho apex allowlist. */
  apiBase: string
}

type ResolveResult =
  | { ok: true; credential: ResolvedZohoDeskCredential }
  | { ok: false; response: NextResponse }

/**
 * Resolve a Zoho Desk credential id into an access token plus the data-center
 * Desk REST base, for the selector routes.
 *
 * Both credential kinds are covered by one path:
 * - `zoho-desk-service-account` (client credentials): the minter returns the
 *   data center's Desk base as `apiDomain` on every mint, so it comes straight
 *   off the token result.
 * - OAuth connection: the token exchange persists the derived Desk base in the
 *   credential's scope string, so it is read back from the `account` row.
 *
 * The token never leaves the server — unlike the previous combobox, which
 * fetched it into the browser before posting it back.
 */
export async function resolveZohoDeskSelectorCredential(
  request: NextRequest,
  params: { credentialId: string; workflowId?: string; requestId: string }
): Promise<ResolveResult> {
  const { credentialId, workflowId, requestId } = params

  const authz = await authorizeCredentialUse(request, { credentialId, workflowId })
  if (!authz.ok || !authz.credentialOwnerUserId) {
    return {
      ok: false,
      response: NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 }),
    }
  }

  const tokenResult = await resolveCredentialAccessToken(
    credentialId,
    authz.credentialOwnerUserId,
    requestId
  )
  if (!tokenResult?.accessToken) {
    logger.error('Failed to get Zoho Desk access token', { credentialId })
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      ),
    }
  }

  // Service-account mints carry `apiDomain`; an OAuth connection stores the same
  // value on its account row instead. Falling through to `undefined` lets
  // getZohoDeskApiBase apply the US default rather than guessing a host.
  const apiDomain = tokenResult.apiDomain ?? (await readOAuthApiDomain(credentialId))

  return {
    ok: true,
    credential: {
      accessToken: tokenResult.accessToken,
      apiBase: getZohoDeskApiBase({ apiDomain }),
    },
  }
}

async function readOAuthApiDomain(credentialId: string): Promise<string | undefined> {
  try {
    const resolved = await resolveOAuthAccountId(credentialId)
    if (!resolved?.accountId) return undefined
    const [row] = await db
      .select({ scope: account.scope })
      .from(account)
      .where(eq(account.id, resolved.accountId))
      .limit(1)
    return extractZohoDeskBaseFromScope(row?.scope)
  } catch (error) {
    logger.warn('Failed to resolve Zoho Desk data center from credential', { error })
    return undefined
  }
}
