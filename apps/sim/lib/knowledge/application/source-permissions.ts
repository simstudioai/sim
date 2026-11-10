import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorPermissionSnapshot,
} from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ConnectorPermissionGrants } from '@/lib/api/contracts/knowledge/connector-permissions'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { searchSourcePermissionOperations } from '@/lib/knowledge/application/operations'
import { writeConnectorPermissions } from '@/lib/knowledge/connectors/permission-store'
import { connectorIsLive } from '@/lib/knowledge/connectors/sync-lock'
import {
  lockOrganizationSearchApproval,
  searchIntegrationAccessCondition,
} from '@/lib/knowledge/search/integration-policy'

interface SourceInput {
  organizationId: string
  sourceId: string
}
interface ReplacementInput extends SourceInput {
  expectedRevision: number
  permissions: ConnectorPermissionGrants
}

function sourceNotFound(): never {
  throw new OrchestrationError(
    'not_found',
    'Search source with externally managed permissions not found'
  )
}

function searchIndex(organizationId: string) {
  return and(
    resourceScopeCondition(knowledgeBase, { kind: 'organization', organizationId }),
    eq(knowledgeBase.isSearchIndex, true),
    isNull(knowledgeBase.deletedAt)
  )
}

function searchSource(sourceId: string) {
  return and(
    eq(knowledgeConnector.id, sourceId),
    eq(knowledgeConnector.accessMode, 'admin'),
    inArray(knowledgeConnector.status, ['active', 'paused', 'pending', 'syncing', 'error']),
    connectorIsLive(),
    searchIntegrationAccessCondition()
  )
}

async function readPermissionSource({ organizationId, sourceId }: SourceInput) {
  if (!(await isKnowledgeMemberAccessAvailable({ organizationId }))) return sourceNotFound()
  const snapshot = knowledgeConnectorPermissionSnapshot
  const [source] = await db
    .select({
      knowledgeBaseId: knowledgeBase.id,
      connectorType: knowledgeConnector.connectorType,
      revision: snapshot.revision,
      metadata: snapshot.metadata,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .innerJoin(snapshot, eq(snapshot.connectorId, knowledgeConnector.id))
    .where(and(searchIndex(organizationId), searchSource(sourceId)))
    .limit(1)
  if (!source) return sourceNotFound()
  const { CONNECTOR_REGISTRY } = await import('@/connectors/registry.server')
  const replacement = CONNECTOR_REGISTRY[source.connectorType]?.permissionConfig?.grantReplacement
  if (!replacement?.supports(source.metadata)) return sourceNotFound()
  return { ...source, replacement }
}

/** Allows CI to pin the revision without disclosing uploaded identities or project memberships. */
export const readSearchSourcePermissions = defineAuthorizedOrganizationUseCase({
  operation: searchSourcePermissionOperations.read,
  async execute({ input }: OrganizationUseCaseContext<SourceInput>) {
    const { revision } = await readPermissionSource(input)
    return { revision }
  },
})

/** Replaces the configured provider’s grants in one revision. */
export const replaceSearchSourcePermissions = defineAuthorizedOrganizationUseCase({
  operation: searchSourcePermissionOperations.replace,
  async execute({ principal, input }: OrganizationUseCaseContext<ReplacementInput>) {
    const { organizationId, sourceId, expectedRevision, permissions } = input
    const source = await readPermissionSource(input)
    if (permissions.provider !== source.connectorType) {
      throw new OrchestrationError(
        'validation',
        'The permissions must match the configured source provider.'
      )
    }
    const prepared = source.replacement.prepare(source, expectedRevision, permissions)
    const revision = await db.transaction(async (tx) => {
      await lockOrganizationSearchApproval(tx, organizationId)
      await authorizeOrganizationOperation(
        principal,
        searchSourcePermissionOperations.replace,
        input,
        {
          executor: tx,
          forShare: true,
        }
      )
      /** Preserve the parent-then-source lock order shared with source removal. */
      const [index] = await tx
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.id, source.knowledgeBaseId), searchIndex(organizationId)))
        .for('share')
      if (!index) return sourceNotFound()
      const [locked] = await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.knowledgeBaseId, index.id),
            eq(knowledgeConnector.connectorType, source.connectorType),
            searchSource(sourceId)
          )
        )
        .for('update')
      if (!locked) return sourceNotFound()
      return writeConnectorPermissions(tx, locked.id, { ...prepared, expectedRevision })
    })
    return { revision }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.CONNECTOR_UPDATED,
    resourceType: AuditResourceType.CONNECTOR,
    resourceId: input.sourceId,
    resourceName: input.permissions.provider,
    description: 'Replaced Search source permissions',
    metadata: { revision: result.revision },
  }),
})
