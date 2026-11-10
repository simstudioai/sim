import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorPermissionSnapshot,
} from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { gitLabSearchPermissionOperations } from '@/lib/knowledge/application/operations'
import { connectorIsLive } from '@/lib/knowledge/connectors/sync-lock'
import {
  lockOrganizationSearchApproval,
  searchIntegrationAccessCondition,
} from '@/lib/knowledge/search/integration-policy'
import {
  prepareGitLabPermissions,
  readGitLabPermissionMetadata,
  writeGitLabPermissions,
} from '@/connectors/gitlab/permission-config/repository'
import type { GitLabCsvUpload } from '@/connectors/gitlab/permission-config/types'

interface SourceInput {
  organizationId: string
  sourceId: string
}
interface ReplacementInput extends SourceInput {
  expectedRevision: number
  userMapping: GitLabCsvUpload
  projectPermissions: GitLabCsvUpload
}

function sourceNotFound(): never {
  throw new OrchestrationError('not_found', 'GitLab CSV Search source not found')
}

function searchIndex(organizationId: string) {
  return and(
    resourceScopeCondition(knowledgeBase, { kind: 'organization', organizationId }),
    eq(knowledgeBase.isSearchIndex, true),
    isNull(knowledgeBase.deletedAt)
  )
}

function gitLabSource(sourceId: string) {
  return and(
    eq(knowledgeConnector.id, sourceId),
    eq(knowledgeConnector.connectorType, 'gitlab'),
    eq(knowledgeConnector.accessMode, 'admin'),
    inArray(knowledgeConnector.status, ['active', 'paused', 'pending', 'syncing', 'error']),
    connectorIsLive(),
    searchIntegrationAccessCondition()
  )
}

async function readCsvSource({ organizationId, sourceId }: SourceInput) {
  if (!(await isKnowledgeMemberAccessAvailable({ organizationId }))) return sourceNotFound()
  const snapshot = knowledgeConnectorPermissionSnapshot
  const [source] = await db
    .select({
      knowledgeBaseId: knowledgeBase.id,
      revision: snapshot.revision,
      metadata: snapshot.metadata,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .innerJoin(snapshot, eq(snapshot.connectorId, knowledgeConnector.id))
    .where(and(searchIndex(organizationId), gitLabSource(sourceId)))
    .limit(1)
  if (!source) return sourceNotFound()
  const metadata = readGitLabPermissionMetadata(source.metadata)
  if (metadata.mode !== 'csv') return sourceNotFound()
  return {
    knowledgeBaseId: source.knowledgeBaseId,
    permissions: { ...metadata, revision: source.revision },
  }
}

/** Allows CI to pin the revision without disclosing uploaded identities or project memberships. */
export const readGitLabSearchPermissions = defineAuthorizedOrganizationUseCase({
  operation: gitLabSearchPermissionOperations.read,
  async execute({ input }: OrganizationUseCaseContext<SourceInput>) {
    const { permissions } = await readCsvSource(input)
    return { revision: permissions.revision }
  },
})

/** Replaces both permission files and the grants they produce in one revision. */
export const replaceGitLabSearchPermissions = defineAuthorizedOrganizationUseCase({
  operation: gitLabSearchPermissionOperations.replace,
  async execute({ principal, input }: OrganizationUseCaseContext<ReplacementInput>) {
    const { organizationId, sourceId, expectedRevision, userMapping, projectPermissions } = input
    const { knowledgeBaseId, permissions } = await readCsvSource(input)
    const prepared = prepareGitLabPermissions(
      { mode: 'csv', expectedRevision, userMapping, projectPermissions },
      permissions,
      permissions,
      true
    )
    await db.transaction(async (tx) => {
      await lockOrganizationSearchApproval(tx, organizationId)
      await authorizeOrganizationOperation(
        principal,
        gitLabSearchPermissionOperations.replace,
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
        .where(and(eq(knowledgeBase.id, knowledgeBaseId), searchIndex(organizationId)))
        .for('share')
      if (!index) return sourceNotFound()
      const [source] = await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(and(eq(knowledgeConnector.knowledgeBaseId, index.id), gitLabSource(sourceId)))
        .for('update')
      if (!source) return sourceNotFound()
      await writeGitLabPermissions(tx, source.id, prepared)
    })
    return { revision: prepared.snapshot.revision }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.CONNECTOR_UPDATED,
    resourceType: AuditResourceType.CONNECTOR,
    resourceId: input.sourceId,
    resourceName: 'gitlab',
    description: 'Replaced GitLab Search permission CSVs',
    metadata: { revision: result.revision },
  }),
})
