import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeOAuth2Contract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { auth, getSession } from '@/lib/auth/auth'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { launchCredentialConnection } from '@/lib/credentials/application/launch-credential-connection'
import { createConnectDraft } from '@/lib/credentials/connect-draft'
import { OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM } from '@/lib/credentials/oauth-draft-state'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('OAuth2Authorize')

export const dynamic = 'force-dynamic'

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
  const { draftId } = parsed.data.query
  let { providerId, workspaceId, callbackURL: requestedCallback, credentialId } = parsed.data.query

  let fromConnectionDraft = false
  let connectionDraftId: string | undefined
  if (draftId) {
    try {
      const sessionId = session.session?.id
      if (!sessionId) throw new Error('Authenticated session is missing its session ID')
      const { draft } = await launchCredentialConnection.execute({
        principal: {
          kind: 'session',
          userId,
          sessionId,
        },
        input: { draftId },
        request,
      })
      providerId = draft.providerId
      workspaceId = draft.workspaceId
      credentialId = draft.credentialId ?? undefined
      connectionDraftId = draft.id
      fromConnectionDraft = true
    } catch (error) {
      if (!(error instanceof OrchestrationError)) throw error
      logger.warn('Rejected OAuth connection draft', { userId, draftId, code: error.code })
      return NextResponse.redirect(`${baseUrl}/workspace?error=oauth_link_invalid`)
    }
  }

  if (!providerId || !workspaceId) {
    throw new Error('Validated OAuth authorization request is missing its target')
  }

  const connectionCompleteUrl = new URL('/oauth/credential-connected', baseUrl)
  connectionCompleteUrl.searchParams.set('result', 'connected')
  const callbackURL = fromConnectionDraft
    ? connectionCompleteUrl.toString()
    : requestedCallback?.startsWith(`${baseUrl}/`)
      ? requestedCallback
      : `${baseUrl}/workspace`

  try {
    let reconnectDisplayName: string | undefined
    if (!fromConnectionDraft) {
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
        reconnectDisplayName = actor.credential.displayName
      }
    }

    requireConfiguredOAuthClient(providerId)

    if (!draftId) {
      const draft = await createConnectDraft({
        userId,
        workspaceId,
        providerId,
        credentialId,
        displayName: reconnectDisplayName,
      })
      connectionDraftId = draft.id
    }

    if (!connectionDraftId) {
      throw new Error('OAuth authorization is missing its credential draft id')
    }

    if (providerId === 'trello' || providerId === 'instagram' || providerId === 'shopify') {
      const authorizeUrl = new URL(`/api/auth/${providerId}/authorize`, baseUrl)
      authorizeUrl.searchParams.set('returnUrl', callbackURL)
      authorizeUrl.searchParams.set('draftId', connectionDraftId)
      return NextResponse.redirect(authorizeUrl)
    }

    const stateCallbackUrl = new URL(callbackURL)
    stateCallbackUrl.searchParams.set(OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM, connectionDraftId)

    const linkResponse = await auth.api.oAuth2LinkAccount({
      body: {
        providerId,
        callbackURL: stateCallbackUrl.toString(),
        ...(fromConnectionDraft
          ? { errorCallbackURL: `${baseUrl}/oauth/credential-connected?result=failed` }
          : {}),
      },
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
