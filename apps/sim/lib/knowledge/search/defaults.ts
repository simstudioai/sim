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
 * is on, hybrid retrieval and the recency boost are the default; elsewhere
 * search stays semantic-only with no boost, exactly as before. An explicit
 * `searchMode` from the caller always wins over the default mode.
 */
export async function resolveKnowledgeSearchDefaults(input: {
  workspaceId: string | undefined
  userId: string | undefined
  requestedMode: KnowledgeSearchMode | undefined
}): Promise<KnowledgeSearchDefaults> {
  const enabled = input.workspaceId
    ? await isKnowledgeMemberAccessAvailable({
        workspaceId: input.workspaceId,
        userId: input.userId,
      })
    : false
  return {
    searchMode: input.requestedMode ?? (enabled ? 'hybrid' : 'vector'),
    boostRecency: enabled,
  }
}
