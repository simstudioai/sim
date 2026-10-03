import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import type { KnowledgeSearchMode } from '@/lib/knowledge/search/queries'

/** How a search runs when the caller did not choose a mode. */
export interface KnowledgeSearchDefaults {
  searchMode: KnowledgeSearchMode
  /** Whether a recently modified document may edge past a stale one of similar relevance. */
  boostRecency: boolean
}

/**
 * The retrieval defaults for one workspace. Where permission-aware knowledge
 * is on, hybrid retrieval is the default and every search gets the recency
 * boost; elsewhere search stays semantic-only with no boost, exactly as
 * before. An explicit `searchMode` from the caller always wins over the
 * default mode; the boost is a workspace policy and applies to either mode.
 */
export async function resolveKnowledgeSearchDefaults(input: {
  workspaceId: string | undefined
  organizationId?: string
  userId: string | undefined
  requestedMode: KnowledgeSearchMode | undefined
}): Promise<KnowledgeSearchDefaults> {
  const enabled =
    input.workspaceId || input.organizationId
      ? await isKnowledgeMemberAccessAvailable({
          workspaceId: input.workspaceId,
          organizationId: input.organizationId,
          userId: input.userId,
        })
      : false
  return {
    searchMode: input.requestedMode ?? (enabled ? 'hybrid' : 'vector'),
    boostRecency: enabled,
  }
}
