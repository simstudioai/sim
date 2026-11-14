import { getOAuthState } from 'better-auth/api'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { isOutboundRoutingEnabled } from '@/lib/core/network/config.server'
import { captureOutboundScope } from '@/lib/core/network/context.server'
import { withResourceOutboundScope } from '@/lib/core/network/resource-scope.server'
import { getActiveConnectDraft } from '@/lib/credentials/connect-draft'
import { parseCredentialDraftIdFromCallbackUrl } from '@/lib/credentials/draft-processor'
import { createOutboundCodeExchange } from '@/lib/oauth/authorization-code.server'

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
 * Whether routing is on, read once while the auth config is built. A routing configuration that
 * fails to load counts as on, so the connector stays wrapped and the bad configuration surfaces
 * on its first request like every other routed call, rather than failing the auth module's load.
 */
function routingConfiguredAtStartup(): boolean {
  try {
    return isOutboundRoutingEnabled()
  } catch {
    return true
  }
}

/**
 * Wraps a generic OAuth connector's code exchange and identity lookup so their vendor calls
 * leave through the connecting organization's egress gateway. A connector without its own
 * `getToken` gets Better Auth's exchange sent through `outboundFetch`, since the plugin's
 * built-in exchange uses its own fetch. Better Auth's own discovery reads for the authorize URL
 * and callback stay unrouted; the exchange resolves its token endpoint through `outboundFetch`.
 * A deployment without outbound routing keeps the connector exactly as configured.
 */
export function withConnectDraftOutboundScope(config: GenericOAuthConfig): GenericOAuthConfig {
  if (!routingConfiguredAtStartup()) return config
  const { providerId, getUserInfo } = config
  const getToken = config.getToken ?? createOutboundCodeExchange(config)
  return {
    ...config,
    getToken:
      getToken && ((data) => runInOAuthCallbackDraftScope(providerId, () => getToken(data))),
    getUserInfo:
      getUserInfo &&
      ((tokens) => runInOAuthCallbackDraftScope(providerId, () => getUserInfo(tokens))),
  }
}
