import type { KnowledgeBaseData } from '@/lib/api/contracts/knowledge'
import { getKnowledgeBases, type KnowledgeBaseScope } from '@/lib/knowledge/service'

/**
 * Lists a viewer's knowledge bases in the wire shape the `/api/knowledge` contract declares.
 *
 * Shared by `GET /api/knowledge` and the Knowledge page's server prefetch so both cache one
 * shape. Dates are serialized because `knowledgeBaseDataSchema` types them `z.string()` —
 * caching raw `Date`s would violate that type and flip to strings on the next refetch.
 */
export async function listKnowledgeBasesForViewer(
  userId: string,
  workspaceId?: string | null,
  scope: KnowledgeBaseScope = 'active'
): Promise<KnowledgeBaseData[]> {
  const bases = await getKnowledgeBases(userId, workspaceId, scope)
  return bases.map((base) => ({
    ...base,
    /** Spread so the closed `ChunkingConfig` interface satisfies the schema's open shape. */
    chunkingConfig: { ...base.chunkingConfig },
    createdAt: base.createdAt.toISOString(),
    updatedAt: base.updatedAt.toISOString(),
    deletedAt: base.deletedAt?.toISOString() ?? null,
  }))
}
