import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import {
  knowledgeConnectorPermissionImport as imports,
  knowledgeConnectorPermissionSnapshot as snapshots,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, getTableColumns, sql } from 'drizzle-orm'
import {
  type PermissionImportManifest,
  permissionImportManifestSchema,
} from '@/lib/api/contracts/v2/source-permission-imports'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { searchSourcePermissionOperations } from '@/lib/knowledge/application/operations'
import {
  readPermissionSource,
  withPermissionSourceLock,
} from '@/lib/knowledge/application/source-permissions'
import { enqueuePermissionImportCleanup } from '@/lib/knowledge/connectors/permission-import-cleanup'
import { PERMISSION_IMPORT_TTL_MS } from '@/lib/knowledge/connectors/permission-import-limits'
import {
  appendPermissionImportPart,
  loadPermissionImport,
  permissionImportSummaries,
  validatePermissionImportScope,
} from '@/lib/knowledge/connectors/permission-import-store'
import { writeConnectorPermissions } from '@/lib/knowledge/connectors/permission-store'
import { prepareGitLabPermissionScope } from '@/connectors/gitlab/permission-config/scope'
import type { GitLabCsvKind } from '@/connectors/gitlab/permission-config/types'

interface SourceInput {
  organizationId: string
  sourceId: string
}
interface ImportInput extends SourceInput {
  importId: string
}
interface CreateInput extends SourceInput {
  manifest: PermissionImportManifest
}
interface PartInput extends ImportInput {
  partNumber: number
  field: GitLabCsvKind
  content: string
}

function credentialBinding(principal: Principal): string {
  if (principal.kind === 'personal_api_key') return `key:${principal.keyId}:${principal.userId}`
  if (principal.kind === 'oauth_access_token')
    return `oauth:${principal.clientId}:${principal.userId}`
  throw new OrchestrationError('forbidden', 'A personal API key or OAuth credential is required.')
}

async function lockedImport(tx: DbTransaction, principal: Principal, input: ImportInput) {
  const [record] = await tx
    .select({
      ...getTableColumns(imports),
      metadata: sql<Record<string, unknown>>`${imports.metadata} - 'projects'`,
    })
    .from(imports)
    .where(and(eq(imports.id, input.importId), eq(imports.connectorId, input.sourceId)))
    .for('update')
  if (!record || record.credentialBinding !== credentialBinding(principal))
    throw new OrchestrationError('not_found', 'Permission import not found.')
  if (record.completedRevision === null && record.expiresAt <= new Date())
    throw new OrchestrationError('conflict', 'This permission import expired. Start a new import.')
  return record
}

async function checkRevision(tx: DbTransaction, sourceId: string, expectedRevision: number) {
  const [snapshot] = await tx
    .select({ revision: snapshots.revision })
    .from(snapshots)
    .where(eq(snapshots.connectorId, sourceId))
    .limit(1)
  if (snapshot?.revision !== expectedRevision)
    throw new OrchestrationError(
      'conflict',
      'Permissions changed. Export a new snapshot using the current revision.'
    )
}

/** Stages a complete replacement without changing searchable permissions. */
export const createSearchSourcePermissionImport = defineAuthorizedOrganizationUseCase({
  operation: searchSourcePermissionOperations.replace,
  async execute({ principal, input }: OrganizationUseCaseContext<CreateInput>) {
    const source = await readPermissionSource(input)
    if (source.connectorType !== input.manifest.provider)
      throw new OrchestrationError('validation', 'The import provider must match the source.')
    const { scope } = await prepareGitLabPermissionScope(
      source,
      input.manifest.expectedRevision,
      source
    )
    const id = generateId()
    const expiresAt = new Date(Date.now() + PERMISSION_IMPORT_TTL_MS)
    await withPermissionSourceLock(principal, input, source, async (tx) => {
      await checkRevision(tx, input.sourceId, input.manifest.expectedRevision)
      const pending = await tx
        .select({ id: imports.id })
        .from(imports)
        .where(eq(imports.connectorId, input.sourceId))
        .limit(3)
      if (pending.length >= 3)
        throw new OrchestrationError(
          'conflict',
          'Previous permission imports are awaiting cleanup. Retry shortly, or wait for unfinished imports to expire.'
        )
      await tx.insert(imports).values({
        id,
        connectorId: input.sourceId,
        credentialBinding: credentialBinding(principal),
        expectedRevision: input.manifest.expectedRevision,
        metadata: scope,
        manifest: input.manifest,
        expiresAt,
      })
      await enqueuePermissionImportCleanup(tx, id, input.sourceId, expiresAt)
    })
    return { id, expiresAt: expiresAt.toISOString() }
  },
})

/** Each bounded part and its receipt commit together, so a lost response can be retried safely. */
export const putSearchSourcePermissionImportPart = defineAuthorizedOrganizationUseCase({
  operation: searchSourcePermissionOperations.replace,
  async execute({ principal, input }: OrganizationUseCaseContext<PartInput>) {
    const source = await readPermissionSource(input, false)
    return withPermissionSourceLock(principal, input, source, async (tx) => {
      const record = await lockedImport(tx, principal, input)
      await checkRevision(tx, input.sourceId, record.expectedRevision)
      return appendPermissionImportPart(tx, record, input)
    })
  },
})

/** Activates only a complete, revalidated generation with the original source revision. */
export const completeSearchSourcePermissionImport = defineAuthorizedOrganizationUseCase({
  operation: searchSourcePermissionOperations.replace,
  async execute({ principal, input }: OrganizationUseCaseContext<ImportInput>) {
    const source = await readPermissionSource(input)
    const record = await loadPermissionImport(input.importId, input.sourceId)
    if (!record || record.credentialBinding !== credentialBinding(principal))
      throw new OrchestrationError('not_found', 'Permission import not found.')
    if (record.completedRevision !== null) return { revision: record.completedRevision }
    if (record.expiresAt <= new Date())
      throw new OrchestrationError(
        'conflict',
        'This permission import expired. Start a new import.'
      )
    const manifest = permissionImportManifestSchema.parse(record.manifest)
    if (
      record.partDigests.length !==
        manifest.userMapping.parts + manifest.projectPermissions.parts ||
      record.userRows !== manifest.userMapping.rowCount ||
      record.projectRows !== manifest.projectPermissions.rowCount
    )
      throw new OrchestrationError(
        'validation',
        'Upload every declared CSV part and row before completing this import.'
      )
    const { scope } = await prepareGitLabPermissionScope(source, record.expectedRevision, source)
    await validatePermissionImportScope(record, scope)
    const summaries = await permissionImportSummaries(record)
    const { revision: _revision, ...metadata } = scope
    const revision = await withPermissionSourceLock(principal, input, source, async (tx) => {
      const locked = await lockedImport(tx, principal, input)
      if (locked.completedRevision !== null) return locked.completedRevision
      await checkRevision(tx, input.sourceId, record.expectedRevision)
      const nextRevision = await writeConnectorPermissions(tx, input.sourceId, {
        expectedRevision: record.expectedRevision,
        metadata: { ...metadata, ...summaries },
        payload: { importId: record.id },
        groups: [],
      })
      await tx
        .update(imports)
        .set({ completedRevision: nextRevision })
        .where(eq(imports.id, record.id))
      return nextRevision
    })
    return { revision }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.CONNECTOR_UPDATED,
    resourceType: AuditResourceType.CONNECTOR,
    resourceId: input.sourceId,
    description: 'Replaced Search source permissions',
    idempotencyKey: `permission-import:${input.importId}`,
    metadata: { revision: result.revision },
  }),
})
