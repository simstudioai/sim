import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  createResourceVfsFolders,
  deleteResourceVfsFolders,
  type FolderedResourceAdapter,
  resolveResourceRowBySegments,
  transferResourceVfsItems,
} from '@/lib/folders/application/resource-vfs'
import { notifyWorkspaceTablesChanged } from '@/lib/realtime/notify'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveTableWorkspaceContext } from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import {
  deleteTable,
  findActiveTablesByExactName,
  listTables,
  moveTableToFolder,
  renameTable,
} from '@/lib/table/service'
import type { TableDefinition } from '@/lib/table/types'

interface TableVfsReferenceInput {
  workspaceId: string
  sourceName: string
  /** Folder segments + leaf name; when present the nested-aware resolver is used. */
  sourceSegments?: string[]
}

const tableVfsAdapter: FolderedResourceAdapter = {
  resourceType: 'table',
  rootSegment: 'tables',
  label: 'table',
  async listRows(workspaceId) {
    const tables = await listTables(workspaceId)
    return tables.map((t) => ({ id: t.id, name: t.name, folderId: t.folderId ?? null }))
  },
  async moveRow(row, folderId, workspaceId) {
    await moveTableToFolder(row.id, workspaceId, folderId, generateRequestId())
  },
  async renameRow(row, newName, workspaceId) {
    const renamed = await renameTable(row.id, newName, generateRequestId(), {
      expectedWorkspaceId: workspaceId,
      skipNotify: true,
    })
    return { id: renamed.id, name: renamed.name }
  },
}

export interface RenameTableByVfsPathInput extends TableVfsReferenceInput {
  newName: string
}

export type DeleteTableByVfsPathInput = TableVfsReferenceInput

async function resolveTableByVfsName(
  workspaceId: string,
  sourceName: string,
  sourceSegments?: string[]
): Promise<TableDefinition> {
  if (sourceSegments && sourceSegments.length > 1) {
    const row = await resolveResourceRowBySegments(tableVfsAdapter, workspaceId, sourceSegments)
    const matches = await findActiveTablesByExactName(workspaceId, row.name)
    const table = matches.find((t) => t.id === row.id)
    if (!table)
      throw new OrchestrationError(
        'not_found',
        `Table not found at tables/${sourceSegments.join('/')}`
      )
    return table
  }
  const matches = await findActiveTablesByExactName(workspaceId, sourceName)
  if (matches.length > 1) {
    throw new OrchestrationError('conflict', `Table path is ambiguous: tables/${sourceName}`)
  }
  const table = matches[0]
  if (!table) throw new OrchestrationError('not_found', `Table not found at tables/${sourceName}`)
  return table
}

export const renameTableByVfsPath = defineAuthorizedTableUseCase({
  operation: tableOperations.renameByVfsPath,
  resolveContext: ({ input }: { input: RenameTableByVfsPathInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ input, context }) {
    const table = await resolveTableByVfsName(
      context.workspaceId,
      input.sourceName,
      input.sourceSegments
    )
    const renamed = await renameTable(table.id, input.newName, generateRequestId(), {
      expectedWorkspaceId: context.workspaceId,
      skipNotify: true,
    })
    return {
      id: renamed.id,
      name: renamed.name,
      previousName: table.name,
      workspaceId: context.workspaceId,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.TABLE_UPDATED,
    resourceType: AuditResourceType.TABLE,
    resourceId: result.id,
    resourceName: result.name,
    description: `Renamed table to "${result.name}"`,
    metadata: { op: 'rename', previousName: result.previousName, source: 'copilot_vfs' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceTablesChanged(context.workspaceId),
})

export const deleteTableByVfsPath = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteByVfsPath,
  resolveContext: ({ input }: { input: DeleteTableByVfsPathInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ input, context }) {
    const table = await resolveTableByVfsName(
      context.workspaceId,
      input.sourceName,
      input.sourceSegments
    )
    const { archived } = await deleteTable(table.id, generateRequestId(), {
      expectedWorkspaceId: context.workspaceId,
      skipNotify: true,
    })
    if (!archived)
      throw new OrchestrationError('not_found', `Table not found at tables/${input.sourceName}`)
    return {
      id: table.id,
      name: archived.name,
      workspaceId: context.workspaceId,
      deleted: true as const,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.TABLE_DELETED,
    resourceType: AuditResourceType.TABLE,
    resourceId: result.id,
    resourceName: result.name,
    description: `Archived table "${result.name}"`,
    metadata: { source: 'copilot_vfs' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceTablesChanged(context.workspaceId),
})

export interface TableVfsPathsInput {
  workspaceId: string
  paths: Array<{ source: string; segments: string[] }>
}

export interface TransferTableVfsItemsInput {
  workspaceId: string
  sources: Array<{ source: string; segments: string[] }>
  destination: { segments: string[]; trailingSlash: boolean }
}

/** mkdir -p under tables/ — folder invariants live in lib/folders. */
export const createTableVfsFolders = defineAuthorizedTableUseCase({
  operation: tableOperations.createFolder,
  resolveContext: ({ input }: { input: TableVfsPathsInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const outcomes = await createResourceVfsFolders(tableVfsAdapter, {
      workspaceId: context.workspaceId,
      userId,
      paths: input.paths,
    })
    return { outcomes, workspaceId: context.workspaceId }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.TABLE_UPDATED,
    resourceType: AuditResourceType.TABLE,
    resourceId: result.workspaceId,
    resourceName: 'tables',
    description: 'Created table folders',
    metadata: { op: 'vfs_mkdir', count: result.outcomes.length, source: 'copilot_vfs' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceTablesChanged(context.workspaceId),
})

/** mv under tables/: rows into folders, folder moves/renames, leaf renames. */
export const transferTableVfsItems = defineAuthorizedTableUseCase({
  operation: tableOperations.moveByVfsPath,
  resolveContext: ({ input }: { input: TransferTableVfsItemsInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const outcomes = await transferResourceVfsItems(tableVfsAdapter, {
      workspaceId: context.workspaceId,
      userId,
      sources: input.sources,
      destination: input.destination,
    })
    return { outcomes, workspaceId: context.workspaceId }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.TABLE_UPDATED,
    resourceType: AuditResourceType.TABLE,
    resourceId: result.workspaceId,
    resourceName: 'tables',
    description: 'Moved table VFS items',
    metadata: { op: 'vfs_mv', count: result.outcomes.length, source: 'copilot_vfs' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceTablesChanged(context.workspaceId),
})

/** rm of tables/ folder paths — recursive via the shared cascade. */
export const deleteTableVfsFolders = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteFolder,
  resolveContext: ({ input }: { input: TableVfsPathsInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const outcomes = await deleteResourceVfsFolders(tableVfsAdapter, {
      workspaceId: context.workspaceId,
      userId,
      paths: input.paths,
    })
    return { outcomes, workspaceId: context.workspaceId }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.TABLE_DELETED,
    resourceType: AuditResourceType.TABLE,
    resourceId: result.workspaceId,
    resourceName: 'tables',
    description: 'Deleted table folders',
    metadata: { op: 'vfs_rm_folder', count: result.outcomes.length, source: 'copilot_vfs' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceTablesChanged(context.workspaceId),
})
