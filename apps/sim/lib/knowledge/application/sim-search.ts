import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import { requireOrganizationMembership } from '@/lib/core/application/organization-authorization'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import {
  type ResourceOwner,
  type ResourceScope,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import { generateRequestId } from '@/lib/core/utils/request'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import {
  requireKnowledgeMemberAccessAvailable,
  requireOrganizationSearchAvailable,
  requireSourceMirroredAccessAvailable,
} from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { createKnowledgeBase } from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { DEFAULT_CHUNKING_CONFIG } from '@/lib/knowledge/constants'
import { getConfiguredKbEmbedding } from '@/lib/knowledge/embeddings'
import { findSearchIndex } from '@/lib/knowledge/search/search-index'
import { createAuthorizedKnowledgeBase } from '@/lib/knowledge/service'
import { canConnectPersonally, SIM_SEARCH_KNOWLEDGE_BASE_NAME } from '@/lib/sim-search/connectors'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

const SIM_SEARCH_KNOWLEDGE_BASE_DESCRIPTION =
  'What each person can open in the sources they connected, searched as them.'

/** Resolves the current Search source configuration without creating it. */
export const readSearchIndex = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readSearchIndex,
  resolveContext: ({ input }: { input: ResourceOwner }) => resolveKnowledgeOwnerContext(input),
  async execute({ context }) {
    if (context.organizationId) await requireOrganizationSearchAvailable(context.organizationId)
    return {
      workspaceId: context.workspaceId,
      knowledgeBaseId: (await findSearchIndex(resourceScopeFromOwner(context)))?.id ?? null,
    }
  },
})

/** Search service sources share a marked knowledge base that stores their configuration. */
async function ensureSearchKnowledgeBase(
  scope: ResourceScope,
  principal: Principal,
  request?: OrchestrationRequestContext
): Promise<string> {
  return coalesceLocally(`sim-search:base:${resourceScopeKey(scope)}`, async () => {
    const existing = await findSearchIndex(scope)
    if (existing) return existing.id
    try {
      if (scope.kind === 'organization') {
        const userId = resolvePrincipalSubjectUserId(principal)
        if (!userId) throw new OrchestrationError('forbidden', 'Sign in to configure sources')
        await requireOrganizationMembership(
          principal,
          scope.organizationId,
          'admin',
          'knowledge.create'
        )
        const embedding = await getConfiguredKbEmbedding()
        const created = await createAuthorizedKnowledgeBase(
          {
            organizationId: scope.organizationId,
            userId,
            name: SIM_SEARCH_KNOWLEDGE_BASE_NAME,
            isSearchIndex: true,
            description: SIM_SEARCH_KNOWLEDGE_BASE_DESCRIPTION,
            embeddingModel: embedding.model,
            embeddingDimension: embedding.dimensions,
            chunkingConfig: DEFAULT_CHUNKING_CONFIG,
          },
          generateRequestId()
        )
        return created.id
      }
      const workspaceId = scope.workspaceId
      const created = await createKnowledgeBase.execute({
        principal,
        input: {
          workspaceId,
          name: SIM_SEARCH_KNOWLEDGE_BASE_NAME,
          isSearchIndex: true,
          description: SIM_SEARCH_KNOWLEDGE_BASE_DESCRIPTION,
          source: 'ui',
        },
        request,
      })
      return created.knowledgeBase.id
    } catch (error) {
      const concurrent = await findSearchIndex(scope)
      if (concurrent) return concurrent.id
      throw error
    }
  })
}

/** Prepares shared Search source configuration before collecting connector credentials. */
export const prepareSearchSource = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.prepareSearchSource,
  resolveContext: ({
    input,
  }: {
    input: ResourceOwner & { connectorType: string; accessMode?: 'admin' | 'members' }
  }) => resolveKnowledgeOwnerContext(input),
  async execute({ principal, input, context, request }) {
    const scope = resourceScopeFromOwner(context)
    const meta = CONNECTOR_META_REGISTRY[input.connectorType]
    if (input.accessMode === 'members') {
      if (!meta || !canConnectPersonally(meta))
        throw new OrchestrationError('validation', 'This source cannot connect member accounts')
      await requireKnowledgeMemberAccessAvailable(context)
      const userId = resolvePrincipalSubjectUserId(principal)
      if (!userId)
        throw new OrchestrationError('forbidden', 'Sign in to configure workspace accounts')
      const group = await ensureWorkspaceAccountsGroup(scope, userId)
      return {
        knowledgeBaseId: await ensureSearchKnowledgeBase(scope, principal, request),
        credentialGroupId: group.id,
      }
    }
    if (!meta?.search || !meta.mirrorsSourceAcls)
      throw new OrchestrationError('validation', 'This source cannot mirror source permissions')
    await requireSourceMirroredAccessAvailable(context)
    return {
      knowledgeBaseId: await ensureSearchKnowledgeBase(scope, principal, request),
    }
  },
})
