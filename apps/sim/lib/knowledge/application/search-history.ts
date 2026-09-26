import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { isSearchHistoryUrl } from '@/lib/knowledge/search/history/limits'
import {
  readSearchHistory,
  type SearchHistoryEvent,
  updateSearchHistory,
} from '@/lib/knowledge/search/history/repository'

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
  execute: ({ context }: OrganizationUseCaseContext<SearchHistoryInput>) =>
    readSearchHistory(context),
})
export const recordSearchHistory = defineAuthorizedOrganizationUseCase({
  operation: searchHistoryOperations.record,
  authorizeResource: ({ context }) => requireOrganizationSearchAvailable(context.organizationId),
  async execute({ input, context }: OrganizationUseCaseContext<RecordSearchHistoryInput>) {
    if (input.event.kind === 'source' && !isSearchHistoryUrl(input.event.source.url))
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
