import type { Principal } from '@sim/auth/principal'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import {
  type CreateKnowledgeConnectorInput,
  createKnowledgeConnector,
  deleteKnowledgeConnector,
  type ListKnowledgeConnectorsInput,
  listKnowledgeConnectors,
  readKnowledgeConnector,
  type UpdateKnowledgeConnectorInput,
  updateKnowledgeConnector,
} from '@/lib/knowledge/application/connectors'
import { resolveActiveKnowledgeConnectorContext } from '@/lib/knowledge/application/contexts'
import { searchSourceOperations } from '@/lib/knowledge/application/operations'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { findSearchIndex } from '@/lib/knowledge/search/search-index'

interface SourceInput {
  organizationId: string
  sourceId: string
}
type CreateInput = Pick<
  CreateKnowledgeConnectorInput,
  'connectorType' | 'credentialId' | 'apiKey' | 'permissionConfig' | 'sourceConfig'
> & {
  organizationId: string
  accessMode: 'admin' | 'members'
}
type ListInput = Pick<ListKnowledgeConnectorsInput, 'sortBy' | 'sortOrder' | 'limit' | 'offset'> & {
  organizationId: string
}

async function requireSearchSource(principal: Principal, input: SourceInput) {
  const context = await resolveActiveKnowledgeConnectorContext(
    {
      connectorId: input.sourceId,
      assertedOrganizationId: input.organizationId,
    },
    principal
  )
  if (
    !context.knowledgeBase.isSearchIndex ||
    !['admin', 'members'].includes(context.connector.accessMode)
  )
    throw new OrchestrationError('not_found', 'Search source not found')
  return context
}

/** Lists administrative source configuration without exposing stored credentials or CSV contents. */
export const listManagedSearchSources = defineAuthorizedOrganizationUseCase({
  operation: searchSourceOperations.list,
  async execute({ principal, input, request }: OrganizationUseCaseContext<ListInput>) {
    const index = await findSearchIndex({
      kind: 'organization',
      organizationId: input.organizationId,
    })
    if (!index)
      return {
        connectors: [],
        hasMore: false,
        offset: input.offset ?? 0,
        limit: input.limit ?? 100,
      }
    const result = await listKnowledgeConnectors.execute({
      principal,
      request,
      input: {
        knowledgeBaseId: index.id,
        assertedOrganizationId: input.organizationId,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
        limit: input.limit,
        offset: input.offset,
      },
    })
    const approvals = await listOrganizationSearchApprovals(input.organizationId)
    return {
      ...result,
      connectors: result.connectors.map((connector) => ({
        ...connector,
        approved: approvals.get(connector.connectorType) === true,
      })),
    }
  },
})

/** Resolves the canonical organization source before reading its administrative configuration. */
export const readManagedSearchSource = defineAuthorizedOrganizationUseCase({
  operation: searchSourceOperations.read,
  async execute({ principal, input, request }: OrganizationUseCaseContext<SourceInput>) {
    const context = await requireSearchSource(principal, input)
    const result = await readKnowledgeConnector.execute({
      principal,
      request,
      input: {
        knowledgeBaseId: context.knowledgeBaseId,
        connectorId: input.sourceId,
        assertedOrganizationId: input.organizationId,
      },
    })
    const approvals = await listOrganizationSearchApprovals(input.organizationId)
    return {
      connector: {
        ...result.connector,
        approved: approvals.get(result.connector.connectorType) === true,
      },
    }
  },
})

/** Creates a source in the prepared Search index using the same validation and write as Settings. */
export const createManagedSearchSource = defineAuthorizedOrganizationUseCase({
  operation: searchSourceOperations.create,
  async execute({ principal, input, request }: OrganizationUseCaseContext<CreateInput>) {
    await requireOrganizationSearchAvailable(input.organizationId)
    const index = await findSearchIndex({
      kind: 'organization',
      organizationId: input.organizationId,
    })
    if (!index)
      throw new OrchestrationError(
        'conflict',
        'Prepare Search sources for this organization before creating a source.'
      )
    const { organizationId, ...configuration } = input
    const result = await createKnowledgeConnector.execute({
      principal,
      request,
      input: {
        ...configuration,
        knowledgeBaseId: index.id,
        assertedOrganizationId: organizationId,
        syncIntervalMinutes: 0,
        source: 'api',
      },
    })
    const approvals = await listOrganizationSearchApprovals(organizationId)
    return {
      connector: {
        ...result.connector,
        approved: approvals.get(result.connector.connectorType) === true,
      },
    }
  },
})

/** Updates source settings while retaining the connector's permission revision and token rules. */
export const updateManagedSearchSource = defineAuthorizedOrganizationUseCase({
  operation: searchSourceOperations.update,
  async execute({
    principal,
    input,
    request,
  }: OrganizationUseCaseContext<
    SourceInput & { updates: UpdateKnowledgeConnectorInput['updates'] }
  >) {
    await requireSearchSource(principal, input)
    const result = await updateKnowledgeConnector.execute({
      principal,
      request,
      input: {
        connectorId: input.sourceId,
        assertedOrganizationId: input.organizationId,
        updates: input.updates,
        source: 'api',
      },
    })
    const approvals = await listOrganizationSearchApprovals(input.organizationId)
    return {
      connector: {
        ...result.connector,
        approved: approvals.get(result.connector.connectorType) === true,
      },
    }
  },
})

/** Removes only the resolved Search source, retaining the existing durable permission cleanup. */
export const deleteManagedSearchSource = defineAuthorizedOrganizationUseCase({
  operation: searchSourceOperations.delete,
  async execute({ principal, input, request }: OrganizationUseCaseContext<SourceInput>) {
    await requireSearchSource(principal, input)
    return deleteKnowledgeConnector.execute({
      principal,
      request,
      input: {
        connectorId: input.sourceId,
        assertedOrganizationId: input.organizationId,
        deleteDocuments: true,
        source: 'api',
      },
    })
  },
})
