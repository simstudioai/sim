import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { createUserKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import {
  readAccessibleHistorySources,
  readSearchHistory,
  type SearchHistoryEvent,
  updateSearchHistory,
} from '@/lib/knowledge/search/history/repository'
import { findSearchIndex } from '@/lib/knowledge/search/search-index'
import { isKnowledgeSourceUrl } from '@/lib/knowledge/search/source-url'

export const searchHistoryOperations = {
  list: defineOrganizationOperation({
    id: 'knowledge.search.history.list',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'knowledge.use',
  }),
  record: defineOrganizationOperation({
    id: 'knowledge.search.history.record',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'knowledge.use',
  }),
  clear: defineOrganizationOperation({
    id: 'knowledge.search.history.clear',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'knowledge.use',
  }),
} as const

interface SearchHistoryInput {
  organizationId: string
}
interface RecordSearchHistoryInput extends SearchHistoryInput {
  event: SearchHistoryEvent
}

/** Navigation history belongs to the current person, never to the connector or organization collectively. */
export const listSearchHistory = defineAuthorizedOrganizationUseCase({
  operation: searchHistoryOperations.list,
  authorizeResource: ({ context }) => requireOrganizationSearchAvailable(context.organizationId),
  async execute({ context, request }: OrganizationUseCaseContext<SearchHistoryInput>) {
    const history = await readSearchHistory(context)
    if (!history.sources.length) return { ...history, sources: [] }
    const index = await findSearchIndex({
      kind: 'organization',
      organizationId: context.organizationId,
    })
    if (!index) return { ...history, sources: [] }
    const access = createUserKnowledgeAccessProvider(context.userId, {
      organizationId: context.organizationId,
      knowledgeBaseIds: [index.id],
      signal: request?.signal,
    })
    const sources = await readAccessibleHistorySources(
      index.id,
      history.sources,
      access,
      request?.signal
    )
    return { ...history, sources }
  },
})
export const recordSearchHistory = defineAuthorizedOrganizationUseCase({
  operation: searchHistoryOperations.record,
  authorizeResource: ({ context }) => requireOrganizationSearchAvailable(context.organizationId),
  async execute({ input, context }: OrganizationUseCaseContext<RecordSearchHistoryInput>) {
    if (input.event.kind === 'source' && !isKnowledgeSourceUrl(input.event.source.url))
      throw new OrchestrationError('validation', 'Source URL must be HTTP(S) without credentials')
    await updateSearchHistory(context, input.event)
    return { success: true as const }
  },
})
export const clearSearchHistory = defineAuthorizedOrganizationUseCase({
  operation: searchHistoryOperations.clear,
  authorizeResource: ({ context }) => requireOrganizationSearchAvailable(context.organizationId),
  async execute({ context }: OrganizationUseCaseContext<SearchHistoryInput>) {
    await updateSearchHistory(context, null)
    return { success: true as const }
  },
})
