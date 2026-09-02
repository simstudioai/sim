import type { KnowledgeBaseData } from '@/lib/api/contracts/knowledge/base'
import type { ChatContext } from '@/stores/panel/types'

/** A search, or an answer drawn from one, spans at most this many knowledge bases. */
export const MAX_SEARCHED_KNOWLEDGE_BASES = 20

type SearchedKnowledgeBase = Pick<KnowledgeBaseData, 'id' | 'name' | 'workspaceId'>

/**
 * The bases a workspace search covers. The list also carries the viewer's
 * legacy personal bases, which have no workspace; a search names one workspace
 * and refuses a base outside it.
 */
export function searchedKnowledgeBases<T extends SearchedKnowledgeBase>(
  bases: readonly T[],
  workspaceId: string
): T[] {
  return bases.filter((kb) => kb.workspaceId === workspaceId).slice(0, MAX_SEARCHED_KNOWLEDGE_BASES)
}

/**
 * The contexts an Ask turn carries: every searched base, attached the way an
 * `@` mention attaches one, so the agent answers from the same documents the
 * Search panel shows. A base the person already mentioned is not attached twice.
 */
export function withSearchedKnowledgeContexts(
  contexts: readonly ChatContext[] | undefined,
  bases: readonly SearchedKnowledgeBase[]
): ChatContext[] {
  const mentioned = new Set<string>()
  for (const context of contexts ?? []) {
    if (context.kind === 'knowledge' && context.knowledgeId) mentioned.add(context.knowledgeId)
  }
  const attached: ChatContext[] = bases
    .filter((kb) => !mentioned.has(kb.id))
    .map((kb) => ({ kind: 'knowledge', knowledgeId: kb.id, label: kb.name }))
  return [...(contexts ?? []), ...attached]
}
