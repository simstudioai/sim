import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import type { V2TableSortBy } from '@/lib/api/contracts/v2/tables'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex, resolveFolderPathFilter } from '@/lib/folders/queries'
import {
  createTable,
  deleteTable,
  getTableById,
  getWorkspaceTableLimits,
  moveTableToFolder,
  queryTables,
  renameTable,
  type TableDefinition,
  type TableSchema,
  updateTableDescription,
} from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  resolveActiveTableContext,
  resolveTableWorkspaceContext,
} from '@/lib/table/application/context'
import { resolveTableFolderPath, tableFolderPathForId } from '@/lib/table/application/folder-paths'
import { tableOperations } from '@/lib/table/application/operations'
import { signalTableSchemaChanged } from '@/lib/table/events'

export interface ListTablesInput {
  workspaceId: string
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
        folderPath: tableFolderPathForId(folderIndex, table.folderId),
      })),
      nextKeys,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    }
  },
})

export interface CreateTableInput {
  workspaceId: string
  name: string
  description?: string
  schema: TableSchema
  folderPath?: string
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
    const resolution = await resolveTableFolderPath(context.workspaceId, input.folderPath ?? '/')
    if (!resolution) throw new OrchestrationError('not_found', 'Folder not found')

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

export type AppliedTableUpdate = 'name' | 'description' | 'folderPath'

export interface UpdateTableInput extends ReadTableInput {
  name?: string
  description?: string | null
  folderPath?: string
}

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
    const applied: AppliedTableUpdate[] = []
    const changed: AppliedTableUpdate[] = []
    const resolution =
      input.folderPath === undefined
        ? undefined
        : await resolveTableFolderPath(context.workspaceId, input.folderPath)
    if (input.folderPath !== undefined && !resolution) {
      throw new OrchestrationError('not_found', 'Folder not found in this workspace')
    }

    let current = context.table
    try {
      if (input.name !== undefined) {
        if (input.name !== current.name) {
          await renameTable(current.id, input.name, generateRequestId(), {
            expectedWorkspaceId: context.workspaceId,
          })
          current = { ...current, name: input.name }
          changed.push('name')
        }
        applied.push('name')
      }

      if (input.description !== undefined) {
        if (input.description !== (current.description ?? null)) {
          await updateTableDescription(
            current.id,
            context.workspaceId,
            input.description,
            generateRequestId()
          )
          current = { ...current, description: input.description }
          changed.push('description')
        }
        applied.push('description')
      }

      if (input.folderPath !== undefined) {
        const folderId = resolution?.folderId ?? null
        if (folderId !== (current.folderId ?? null)) {
          await moveTableToFolder(current.id, context.workspaceId, folderId, generateRequestId())
          current = { ...current, folderId }
          changed.push('folderPath')
        }
        applied.push('folderPath')
      }

      const table = await getTableById(current.id)
      if (!table || table.workspaceId !== context.workspaceId) {
        throw new OrchestrationError(
          'not_found',
          'Table not found in this workspace — run glob("tables/*") to list valid tables'
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
      return { table: current, folderPath: null, applied, changed, failure }
    }
  },
  projectAudit({ input, context, result }) {
    return result.changed.map((field) => {
      if (field === 'name') {
        return {
          action: AuditAction.TABLE_UPDATED,
          resourceType: AuditResourceType.TABLE,
          resourceId: context.table.id,
          resourceName: input.name ?? context.table.name,
          description: `Renamed table to "${input.name}"`,
          metadata: { op: 'rename', previousName: context.table.name },
        }
      }
      if (field === 'description') {
        return {
          action: AuditAction.TABLE_UPDATED,
          resourceType: AuditResourceType.TABLE,
          resourceId: context.table.id,
          resourceName: result.table?.name ?? context.table.name,
          description: `Updated description for table "${result.table?.name ?? context.table.name}"`,
          metadata: { op: 'description' },
        }
      }
      return {
        action: AuditAction.TABLE_UPDATED,
        resourceType: AuditResourceType.TABLE,
        resourceId: context.table.id,
        resourceName: result.table?.name ?? context.table.name,
        description:
          input.folderPath === '/'
            ? `Moved table "${result.table?.name ?? context.table.name}" to the workspace root`
            : `Moved table "${result.table?.name ?? context.table.name}" into a folder`,
        metadata: { op: 'move', folderPath: input.folderPath },
      }
    })
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
        'Table not found in this workspace — run glob("tables/*") to list valid tables'
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
