import { db } from '@sim/db'
import { credential, pendingCredentialDraft, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, lt } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeOAuth2Contract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { auth, getSession } from '@/lib/auth/auth'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { defaultCredentialDisplayName } from '@/lib/credentials/display-name'
import { getAllOAuthServices } from '@/lib/oauth/utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('OAuth2Authorize')

export const dynamic = 'force-dynamic'

const DRAFT_TTL_MS = 15 * 60 * 1000

/**
 * Creates the pending credential draft at click time so its TTL starts when the
 * user actually initiates the connect. Better Auth's `account.create.after` hook
 * consumes this draft to materialize the real credential after the OAuth
 * callback; starting the clock here guarantees the draft outlives the (≤5 min)
 * OAuth round-trip rather than expiring mid-flow and silently producing no
 * credential.
 */
async function createConnectDraft(params: {
  userId: string
  workspaceId: string
  providerId: string
  credentialId?: string
}): Promise<void> {
  const { userId, workspaceId, providerId, credentialId } = params

  const service = getAllOAuthServices().find((s) => s.providerId === providerId)
  const serviceName = service?.name ?? providerId

  let userName: string | null = null
  try {
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId))
    userName = row?.name ?? null
  } catch {
    // Fall back to the "My {Service}" default
  }

  // Auto-number against existing workspace credentials so repeat connects for
  // the same provider stay distinguishable — same behavior as the connect
  // modal, which computes this client-side. Best effort: on failure the name
  // simply skips deduplication.
  let takenNames: ReadonlySet<string> = new Set<string>()
  try {
    const rows = await db
      .select({ displayName: credential.displayName })
      .from(credential)
      .where(and(eq(credential.workspaceId, workspaceId), eq(credential.type, 'oauth')))
    takenNames = new Set(rows.map((row) => row.displayName.toLowerCase()))
  } catch {
    // Best effort — proceed without collision numbering
  }

  const displayName = defaultCredentialDisplayName(userName, serviceName, takenNames)

  const now = new Date()
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS)
  await db
    .delete(pendingCredentialDraft)
    .where(
      and(eq(pendingCredentialDraft.userId, userId), lt(pendingCredentialDraft.expiresAt, now))
    )
  await db
    .insert(pendingCredentialDraft)
    .values({
      id: generateId(),
      userId,
      workspaceId,
      providerId,
      displayName,
      credentialId: credentialId ?? null,
      expiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        pendingCredentialDraft.userId,
        pendingCredentialDraft.providerId,
        pendingCredentialDraft.workspaceId,
      ],
      // credentialId must be written on BOTH paths: a plain connect that reuses a
      // stale reconnect draft row would otherwise silently rebind the old
      // credential instead of creating a new one.
      set: { displayName, credentialId: credentialId ?? null, expiresAt, createdAt: now },
    })

  logger.info('Created OAuth connect credential draft', {
    userId,
    workspaceId,
    providerId,
    credentialId: credentialId ?? null,
  })
}

/**
 * Browser-initiated entrypoint for linking a generic OAuth2 account.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const baseUrl = getBaseUrl()

  const session = await getSession()
  if (!session?.user?.id) {
    const loginUrl = new URL('/login', baseUrl)
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl.toString())
  }
  const userId = session.user.id

  const parsed = await parseRequest(authorizeOAuth2Contract, request, {})
  if (!parsed.success) return parsed.response
  const {
    providerId,
    workspaceId,
    callbackURL: requestedCallback,
    credentialId,
  } = parsed.data.query

  const callbackURL = requestedCallback?.startsWith(`${baseUrl}/`)
    ? requestedCallback
    : `${baseUrl}/workspace`

  try {
    const access = await checkWorkspaceAccess(workspaceId, userId)
    if (!access.canWrite) {
      logger.warn('Workspace write access denied for OAuth2 authorize', {
        userId,
        workspaceId,
        providerId,
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=workspace_access_denied`)
    }

    if (credentialId) {
      // Reconnect: the OAuth callback will rebind this credential to the fresh
      // account, so require the same credential-admin access as the draft POST
      // route — workspace write alone must not be enough to swap someone's tokens.
      const actor = await getCredentialActorContext(credentialId, userId, {
        workspaceAccess: access,
      })
      if (
        !actor.credential ||
        actor.credential.workspaceId !== workspaceId ||
        actor.credential.type !== 'oauth' ||
        !actor.isAdmin
      ) {
        logger.warn('Credential admin access denied for OAuth2 reconnect', {
          userId,
          workspaceId,
          providerId,
          credentialId,
        })
        return NextResponse.redirect(`${baseUrl}/workspace?error=credential_access_denied`)
      }
      if (actor.credential.providerId !== providerId) {
        logger.warn('Provider mismatch for OAuth2 reconnect', {
          userId,
          workspaceId,
          providerId,
          credentialId,
          credentialProviderId: actor.credential.providerId,
        })
        return NextResponse.redirect(`${baseUrl}/workspace?error=credential_provider_mismatch`)
      }
    }

    // Create the draft before initiating the link so it is guaranteed to exist
    // (and freshly clocked) when the OAuth callback's `account.create.after`
    // hook runs. If this throws, we never start the OAuth flow.
    await createConnectDraft({ userId, workspaceId, providerId, credentialId })

    const linkResponse = await auth.api.oAuth2LinkAccount({
      body: { providerId, callbackURL },
      headers: request.headers,
      asResponse: true,
    })

    const payload = (await linkResponse.json().catch(() => null)) as { url?: string } | null
    if (!linkResponse.ok || !payload?.url) {
      logger.error('oAuth2LinkAccount did not return an authorization URL', {
        providerId,
        status: linkResponse.status,
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=oauth_link_failed`)
    }

    const response = NextResponse.redirect(payload.url)
    // Forward the signed `state` cookie Better Auth set so it lands in the user's
    // browser and is present when the provider redirects back to the callback.
    const linkHeaders = linkResponse.headers as Headers & {
      getSetCookie?: () => string[]
    }
    for (const cookie of linkHeaders.getSetCookie?.() ?? []) {
      response.headers.append('set-cookie', cookie)
    }
    return response
  } catch (error) {
    logger.error('Failed to initiate OAuth2 authorization', { providerId, error })
    return NextResponse.redirect(`${baseUrl}/workspace?error=oauth_link_failed`)
  }
})
