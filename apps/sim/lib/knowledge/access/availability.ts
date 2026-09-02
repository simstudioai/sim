import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/**
 * Who is asking, for the flag's workspace allowlist and platform-admin
 * clauses. `userId` is the signed-in user when there is one; an actorless
 * caller (a schedule, a cron, an API key) passes none and is judged by the
 * workspace alone.
 */
export interface KnowledgeMemberAccessContext {
  workspaceId: string
  userId?: string
}

/**
 * Whether permission-aware knowledge is on for this workspace: members-mode
 * connectors, their per-member change feeds, and hybrid-by-default retrieval
 * with the source-recency boost. Everything the feature adds checks this one
 * gate, so turning the flag off freezes members-mode connectors (their
 * documents stay hidden, nothing is deleted) and returns search to the
 * semantic-only default.
 */
export async function isKnowledgeMemberAccessAvailable(
  context: KnowledgeMemberAccessContext
): Promise<boolean> {
  return isFeatureEnabled('knowledge-member-access', context)
}
