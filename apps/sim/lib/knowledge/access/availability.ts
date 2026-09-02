import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/**
 * Who is asking. Members mode — creating, switching, syncing, and honouring
 * member tokens — is judged by the workspace alone, because the member engine
 * has no person to speak for and every gate must agree with it. Retrieval
 * defaults pass the signed-in user as well, so the flag's platform-admin
 * clause lets an admin try hybrid retrieval anywhere; an actorless caller
 * (a schedule, a cron, a workspace API key) passes none.
 */
export interface KnowledgeMemberAccessContext {
  workspaceId: string
  userId?: string
}

/**
 * Whether permission-aware knowledge is on for this workspace: members-mode
 * connectors, their per-member change feeds, and hybrid-by-default retrieval
 * with the source-recency boost. Everything the feature adds checks this one
 * gate. Turning the flag off hides every member-scoped document on the next
 * read, disables each members-mode connector on its next run (members are
 * suspended, nothing is deleted), and returns search to the semantic-only
 * default; a disabled connector is re-enabled by switching its access again.
 */
export async function isKnowledgeMemberAccessAvailable(
  context: KnowledgeMemberAccessContext
): Promise<boolean> {
  return isFeatureEnabled('knowledge-member-access', context)
}
