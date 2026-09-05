import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { type SearchKnowledgeInput, searchKnowledge } from '@/lib/knowledge/application/search'
import { findWorkspaceSearchIndex } from '@/lib/knowledge/search/search-index'

export type SearchWorkspaceKnowledgeInput = Omit<
  SearchKnowledgeInput,
  'knowledgeBaseIds' | 'workspaceId'
> & {
  workspaceId: string
}

/** Search and Assistant share the workspace's canonical Enterprise Search index. */
export const searchWorkspaceKnowledge = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ input }: { input: SearchWorkspaceKnowledgeInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context }) {
    const index = await findWorkspaceSearchIndex(context.workspaceId)
    if (!index) return { results: [], query: input.query ?? '', knowledgeBases: [] }
    return searchKnowledge.execute({
      principal,
      input: { ...input, workspaceId: context.workspaceId, knowledgeBaseIds: [index.id] },
    })
  },
})
