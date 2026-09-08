import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  resolveKnowledgeOrganizationContext,
  resolveKnowledgeOwnerContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { type SearchKnowledgeInput, searchKnowledge } from '@/lib/knowledge/application/search'
import { findSearchIndex, findWorkspaceSearchIndex } from '@/lib/knowledge/search/search-index'

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

export type SearchOrganizationKnowledgeInput = Omit<
  SearchWorkspaceKnowledgeInput,
  'workspaceId'
> & { organizationId: string }

/** Organization Search and Assistant resolve the same index and provider ACLs. */
export const searchOrganizationKnowledge = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ input }: { input: SearchOrganizationKnowledgeInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input, context }) {
    const index = await findSearchIndex({
      kind: 'organization',
      organizationId: context.organizationId,
    })
    if (!index) return { results: [], query: input.query ?? '', knowledgeBases: [] }
    return searchKnowledge.execute({ principal, input: { ...input, knowledgeBaseIds: [index.id] } })
  },
})

export type SearchScopedKnowledgeInput = Omit<
  SearchKnowledgeInput,
  'knowledgeBaseIds' | 'workspaceId' | 'organizationId'
> &
  ResourceOwner

/** The routed owner selects the index; current membership and provider ACLs select its documents. */
export const searchScopedKnowledge = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ input }: { input: SearchScopedKnowledgeInput }) =>
    resolveKnowledgeOwnerContext(input),
  async execute({ principal, input, context }) {
    const index = await findSearchIndex(resourceScopeFromOwner(context))
    if (!index) return { results: [], query: input.query ?? '', knowledgeBases: [] }
    return searchKnowledge.execute({
      principal,
      input: {
        ...input,
        workspaceId: input.workspaceId ?? undefined,
        organizationId: input.organizationId ?? undefined,
        knowledgeBaseIds: [index.id],
      },
    })
  },
})
