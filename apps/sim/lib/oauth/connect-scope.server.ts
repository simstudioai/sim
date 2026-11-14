import { getOAuthState } from 'better-auth/api'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { isOutboundRoutingEnabled } from '@/lib/core/network/config.server'
import { captureOutboundScope } from '@/lib/core/network/context.server'
import { withResourceOutboundScope } from '@/lib/core/network/resource-scope.server'
import { getActiveConnectDraft } from '@/lib/credentials/connect-draft'
import { parseCredentialDraftIdFromCallbackUrl } from '@/lib/credentials/draft-processor'

type OutboundScopeRunner = <T>(run: () => Promise<T>) => Promise<T>

/**
 * Resolves the outbound scope for a custom OAuth callback's vendor calls (code exchange,
 * identity lookup) from the workspace or organization that owns its connect draft, so an
 * organization with a dedicated egress gateway connects from its own static IPs.
 *
 * Ownership comes from the caller's own unexpired draft row, never from the request, and
 * is resolved once so every vendor call in the callback reuses it. Without a draft bound
 * to this user and provider, the runner leaves calls unscoped.
 */
export async function resolveConnectDraftOutboundScope(params: {
  draftId: string | undefined
  userId: string
  providerId: string
}): Promise<OutboundScopeRunner> {
  if (!isOutboundRoutingEnabled() || !params.draftId) return (run) => run()
  const draft = await getActiveConnectDraft(params.draftId, params.userId)
  if (!draft || draft.providerId !== params.providerId) return (run) => run()
  return withResourceOutboundScope(
    { workspaceId: draft.workspaceId, organizationId: draft.organizationId },
    async () => captureOutboundScope()
  )
}

/** One draft lookup per callback, shared by its code exchange and identity lookup. */
const callbackDraftScopes = new WeakMap<object, Promise<OutboundScopeRunner>>()

/**
 * Runs a generic OAuth callback step in the scope of the connect draft named by Better Auth's
 * server-verified OAuth state (`link.userId` started the link, `callbackURL` carries the draft
 * id). A sign-in callback, which has no `link`, runs unscoped.
 */
async function runInOAuthCallbackDraftScope<T>(
  providerId: string,
  run: () => Promise<T>
): Promise<T> {
  const state = await getOAuthState()
  const userId = state?.link?.userId
  if (!userId) return run()
  let inDraftScope = callbackDraftScopes.get(state)
  if (!inDraftScope) {
    inDraftScope = resolveConnectDraftOutboundScope({
      draftId: parseCredentialDraftIdFromCallbackUrl(state.callbackURL),
      userId,
      providerId,
    })
    callbackDraftScopes.set(state, inDraftScope)
  }
  return (await inDraftScope)(run)
}

/**
 * Wraps a generic OAuth connector's custom code exchange and identity lookup so their vendor
 * calls leave through the connecting organization's egress gateway. Better Auth's built-in
 * exchange (providers without `getToken`) uses its own fetch and is not routed.
 */
export function withConnectDraftOutboundScope(config: GenericOAuthConfig): GenericOAuthConfig {
  const { providerId, getToken, getUserInfo } = config
  return {
    ...config,
    getToken:
      getToken && ((data) => runInOAuthCallbackDraftScope(providerId, () => getToken(data))),
    getUserInfo:
      getUserInfo &&
      ((tokens) => runInOAuthCallbackDraftScope(providerId, () => getUserInfo(tokens))),
  }
}
