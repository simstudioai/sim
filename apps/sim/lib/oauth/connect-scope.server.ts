import { isOutboundRoutingEnabled } from '@/lib/core/network/config.server'
import { captureOutboundScope } from '@/lib/core/network/context.server'
import { withResourceOutboundScope } from '@/lib/core/network/resource-scope.server'
import { getActiveConnectDraft } from '@/lib/credentials/connect-draft'

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
