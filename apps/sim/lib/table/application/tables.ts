import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import type { V2TableSortBy } from '@/lib/api/contracts/v2/tables'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import {
  findActiveFolder,
  loadActiveFolderPathIndex,
  resolveFolderPathFilter,
} from '@/lib/folders/queries'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  resolveActiveTableContext,
  resolveArchivedTableContext,
  resolveTableWorkspaceContext,
} from '@/lib/table/application/context'
import {
  archivableTableFolderPath,
  resolveTableFolderPath,
  tableFolderPathForId,
} from '@/lib/table/application/folder-paths'
import { tableOperations } from '@/lib/table/application/operations'
import { getWorkspaceTableLimits } from '@/lib/table/billing'
import { signalTableSchemaChanged } from '@/lib/table/events'
import {
  createTable,
  deleteTable,
  getTableById,
  listTables as listTableDefinitions,
  moveTableToFolder,
  queryTables,
  renameTable,
  restoreTable,
  type TableScope,
  updateTableDescription,
} from '@/lib/table/service'
import type { TableWriteTx } from '@/lib/table/tx'
import type { TableDefinition, TableSchema } from '@/lib/table/types'

export interface ListTablesInput {
  workspaceId: string
  /**
   * Which lifecycle set to list. Omitted means `active`, matching every shipped
   * caller. Deliberately narrower than the `TableScope` the query layer takes:
   * its third value, `'all'`, would mix archived rows into a page projected by
   * the strict folder-path resolver, which throws on the dangling `folderId` a
   * folder archive leaves behind.
   */
  scope?: 'active' | 'archived'
  folderPath?: string
  search?: string
  sortBy: V2TableSortBy
  sortOrder: ListSortOrder
  limit: number
  after?: CursorKey[]
}

export const listTablesUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.list,
  resolveContext: ({ input }: { input: ListTablesInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ input, context }) {
    const folderIndex = await loadActiveFolderPathIndex(context.workspaceId, 'table', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    const folderFilter = resolveFolderPathFilter(folderIndex, input.folderPath)
    if (folderFilter.kind === 'noMatch') {
      return { tables: [], nextKeys: null, sortBy: input.sortBy, sortOrder: input.sortOrder }
    }

    const { tables, nextKeys } = await queryTables(context.workspaceId, {
      scope: input.scope,
      folderId: folderFilter.kind === 'folder' ? folderFilter.folderId : undefined,
      search: input.search,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      limit: input.limit,
      after: input.after,
    })

    return {
      tables: tables.map((table) => ({
        table,
        folderPath:
          input.scope === 'archived'
            ? archivableTableFolderPath(folderIndex, table.folderId)
            : tableFolderPathForId(folderIndex, table.folderId),
      })),
      nextKeys,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    }
  },
})

export interface ListTableDefinitionsInput {
  workspaceId: string
  scope?: TableScope
}

export const listTableDefinitionsUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.list,
  resolveContext: ({ input }: { input: ListTableDefinitionsInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ input, context }) {
    return {
      tables: await listTableDefinitions(context.workspaceId, { scope: input.scope }),
    }
  },
})

export interface CreateTableInput {
  workspaceId: string
  name: string
  description?: string
  schema: TableSchema
  folderPath?: string
  folderId?: string | null
  initialRowCount?: number
}

export const createTableUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.create,
  resolveContext: ({ input }: { input: CreateTableInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const planLimits = await getWorkspaceTableLimits(context.workspaceId)
    const resolution =
      input.folderId !== undefined
        ? {
            folderId: input.folderId,
            index: await loadActiveFolderPathIndex(context.workspaceId, 'table', undefined, {
              maxRows: MAX_FOLDERS_PER_WORKSPACE,
            }),
          }
        : await resolveTableFolderPath(context.workspaceId, input.folderPath ?? '/')
    if (
      !resolution ||
      (input.folderId && !(await findActiveFolder(input.folderId, context.workspaceId, 'table')))
    ) {
      throw new OrchestrationError('not_found', 'Folder not found in this workspace')
    }

    const table = await createTable(
      {
        name: input.name,
        description: input.description,
        schema: input.schema,
        workspaceId: context.workspaceId,
        userId: attribution.attributedUserId,
        maxTables: planLimits.maxTables,
        folderId: resolution.folderId,
        initialRowCount: input.initialRowCount,
      },
      generateRequestId()
    )

    return {
      table,
      folderPath: tableFolderPathForId(resolution.index, table.folderId),
    }
  },
  projectAudit({ input, result }) {
    return {
      action: AuditAction.TABLE_CREATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Created table "${result.table.name}"`,
      metadata: { columnCount: input.schema.columns.length },
    }
  },
})

export interface ReadTableInput {
  tableId: string
  workspaceId: string
}

export const readTableUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.read,
  resolveContext: ({ input }: { input: ReadTableInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ context }) {
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'table', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    return {
      table: context.table,
      folderPath: tableFolderPathForId(index, context.table.folderId),
    }
  },
})

export const readTableDefinitionUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.read,
  resolveContext: ({ input }: { input: ReadTableInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ context }) {
    return { table: context.table }
  },
})

export const readTableDetailsUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.read,
  resolveContext: ({ input }: { input: ReadTableInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ context }) {
    const { maxRowsPerTable } = await getWorkspaceTableLimits(context.workspaceId)
    return { table: context.table, maxRows: maxRowsPerTable }
  },
})

export type AppliedTableUpdate = 'name' | 'description' | 'folderPath'

/** A table's own fields as an update sets them; an absent field is left alone. */
export interface TableFieldsInput {
  name?: string
  description?: string | null
  folderPath?: string
}

/** How far {@link writeTableFields} got: the table as written so far and the fields it took. */
export interface TableFieldsProgress {
  current: TableDefinition
  applied: AppliedTableUpdate[]
  changed: AppliedTableUpdate[]
}

/** The folder a `folderPath` input names, refusing one the workspace does not hold. */
export async function resolveFolderInput(workspaceId: string, folderPath: string | undefined) {
  if (folderPath === undefined) return undefined
  const resolution = await resolveTableFolderPath(workspaceId, folderPath)
  if (!resolution) throw new OrchestrationError('not_found', 'Folder not found in this workspace')
  return resolution
}

/**
 * Writes a table's name, description and folder where `input` changes them, recording each step
 * on `progress` as it lands. With `tx` the writes join that transaction; without, each commits on
 * its own, and a failure leaves `progress` at what committed.
 */
export async function writeTableFields(
  progress: TableFieldsProgress,
  input: TableFieldsInput,
  folderId: string | null | undefined,
  tx?: TableWriteTx
): Promise<void> {
  const { workspaceId } = progress.current
  if (input.name !== undefined) {
    if (input.name !== progress.current.name) {
      await renameTable(progress.current.id, input.name, generateRequestId(), {
        expectedWorkspaceId: workspaceId,
        tx,
      })
      progress.current = { ...progress.current, name: input.name }
      progress.changed.push('name')
    }
    progress.applied.push('name')
  }
  if (input.description !== undefined) {
    if (input.description !== (progress.current.description ?? null)) {
      await updateTableDescription(
        progress.current.id,
        workspaceId,
        input.description,
        generateRequestId(),
        { tx }
      )
      progress.current = { ...progress.current, description: input.description }
      progress.changed.push('description')
    }
    progress.applied.push('description')
  }
  if (input.folderPath !== undefined) {
    const next = folderId ?? null
    if (next !== (progress.current.folderId ?? null)) {
      await moveTableToFolder(progress.current.id, workspaceId, next, generateRequestId(), { tx })
      progress.current = { ...progress.current, folderId: next }
      progress.changed.push('folderPath')
    }
    progress.applied.push('folderPath')
  }
}

/** The audit entries of the table fields an update changed, one per field. */
export function tableFieldAudits(
  table: TableDefinition,
  input: TableFieldsInput,
  changed: readonly AppliedTableUpdate[],
  finalName: string | undefined
) {
  const name = finalName ?? table.name
  return changed.map((field) => {
    if (field === 'name') {
      return {
        action: AuditAction.TABLE_UPDATED,
        resourceType: AuditResourceType.TABLE,
        resourceId: table.id,
        resourceName: input.name ?? table.name,
        description: `Renamed table to "${input.name}"`,
        metadata: { op: 'rename', previousName: table.name },
      }
    }
    if (field === 'description') {
      return {
        action: AuditAction.TABLE_UPDATED,
        resourceType: AuditResourceType.TABLE,
        resourceId: table.id,
        resourceName: name,
        description: `Updated description for table "${name}"`,
        metadata: { op: 'description' },
      }
    }
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: table.id,
      resourceName: name,
      description:
        input.folderPath === '/'
          ? `Moved table "${name}" to the workspace root`
          : `Moved table "${name}" into a folder`,
      metadata: { op: 'move', folderPath: input.folderPath },
    }
  })
}

export interface UpdateTableInput extends ReadTableInput, TableFieldsInput {}

export interface UpdateTableResult {
  table: TableDefinition | null
  folderPath: string | null
  applied: AppliedTableUpdate[]
  changed: AppliedTableUpdate[]
  failure?: unknown
}

export const updateTableUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.update,
  resolveContext: ({ input }: { input: UpdateTableInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ input, context }): Promise<UpdateTableResult> {
    const resolution = await resolveFolderInput(context.workspaceId, input.folderPath)
    const progress: TableFieldsProgress = { current: context.table, applied: [], changed: [] }
    try {
      await writeTableFields(progress, input, resolution?.folderId)
      const { applied, changed } = progress
      const table = await getTableById(progress.current.id)
      if (!table || table.workspaceId !== context.workspaceId) {
        throw new OrchestrationError(
          'not_found',
          'Table not found in this workspace — list the tables in this workspace to see valid table ids'
        )
      }
      const index =
        resolution?.index ??
        (await loadActiveFolderPathIndex(context.workspaceId, 'table', undefined, {
          maxRows: MAX_FOLDERS_PER_WORKSPACE,
        }))
      return {
        table,
        folderPath: tableFolderPathForId(index, table.folderId),
        applied,
        changed,
      }
    } catch (failure) {
      const { current, applied, changed } = progress
      return { table: current, folderPath: null, applied, changed, failure }
    }
  },
  projectAudit({ input, context, result }) {
    return tableFieldAudits(context.table, input, result.changed, result.table?.name)
  },
  afterSuccess({ context, result }) {
    if (result.changed.length > 0) signalTableSchemaChanged(context.table.id)
  },
})

export const deleteTableUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.delete,
  resolveContext: ({ input }: { input: ReadTableInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const { archived } = await deleteTable(context.table.id, generateRequestId(), {
      expectedWorkspaceId: context.workspaceId,
    })
    if (!archived)
      throw new OrchestrationError(
        'not_found',
        'Table not found in this workspace — list the tables in this workspace to see valid table ids'
      )
    return {
      id: context.table.id,
      deleted: true as const,
      archived: true as const,
      tableName: archived.name,
      workspaceId: context.workspaceId,
      attributedUserId: attribution.attributedUserId,
    }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.TABLE_DELETED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.id,
      resourceName: result.tableName,
      description: `Archived table "${result.tableName}"`,
    }
  },
})

/**
 * Un-archives a table that {@link deleteTableUseCase} archived.
 *
 * Calls the service primitive rather than `performRestoreTable`: that
 * orchestration records its own audit row keyed on a bare `userId`, which
 * cannot represent a workspace-key or delegated principal. Audit is projected
 * here instead, from the authoritative restored row.
 *
 * Restore is deliberately not gated by the delete lock — see `restoreTable`.
 *
 * Idempotent: a table that is already active is returned unchanged, with no
 * restore performed and no audit entry recorded. A `409` there would make a
 * retry after a dropped response look like a failure, and restore has no state
 * a second call could corrupt — the same position the knowledge surface takes
 * on its own restore.
 */
export const restoreTableUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.restore,
  resolveContext: ({ input }: { input: ReadTableInput }) =>
    resolveArchivedTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ context }) {
    const restored = context.table.archivedAt !== null
    if (restored) {
      await restoreTable(context.table.id, generateRequestId())
    }
    const table = await getTableById(context.table.id)
    if (!table || table.workspaceId !== context.workspaceId) {
      throw new OrchestrationError('not_found', 'Table not found')
    }
    const index = await loadActiveFolderPathIndex(context.workspaceId, 'table', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    return { table, folderPath: tableFolderPathForId(index, table.folderId), restored }
  },
  projectAudit({ result }) {
    return result.restored
      ? [
          {
            action: AuditAction.TABLE_RESTORED,
            resourceType: AuditResourceType.TABLE,
            resourceId: result.table.id,
            resourceName: result.table.name,
            description: `Restored table "${result.table.name}"`,
          },
        ]
      : []
  },
  afterSuccess({ result }) {
    if (result.restored) signalTableSchemaChanged(result.table.id)
  },
})
