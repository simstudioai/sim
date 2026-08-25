import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import {
  OrchestrationError,
  type OrchestrationErrorCode,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { columnMatchesRef, getColumnId } from '@/lib/table/column-keys'
import { columnTypeById } from '@/lib/table/column-types'
import {
  type ColumnMutationOptions,
  renameColumn,
  updateColumnConstraints,
  updateColumnCurrency,
  updateColumnOptions,
  updateColumnReference,
  updateColumnType,
} from '@/lib/table/columns/service'
import { isSupportedCurrencyCode } from '@/lib/table/currency'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { normalizeSelectOptionsInput } from '@/lib/table/select-options'
import type { ColumnType, SelectOption, TableDefinition, TableLockKind } from '@/lib/table/types'

const logger = createLogger('TableColumnOrchestration')

function workspaceMutationOptions(
  expectedWorkspaceId: string | undefined
): [] | [ColumnMutationOptions] {
  return expectedWorkspaceId ? [{ expectedWorkspaceId }] : []
}

export interface PerformUpdateTableColumnParams {
  table: TableDefinition
  columnName: string
  userId: string
  updates: {
    name?: string
    type?: ColumnType
    required?: boolean
    unique?: boolean
    /** Accepts `{id,name}` pairs or bare names; ids are minted/reused as needed. */
    options?: unknown
    multiple?: boolean
    currencyCode?: string
    referenceTableId?: string
  }
  requestId?: string
  expectedWorkspaceId?: string
  recordAudit?: boolean
  /** Forwarded to the audit record for IP / user-agent capture. */
  request?: OrchestrationRequestContext
}

export interface PerformUpdateTableColumnResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  /** Which lock rejected the write. Set only when `errorCode` is `'locked'`. */
  lock?: TableLockKind
  table?: TableDefinition
}

function classify(error: unknown): PerformUpdateTableColumnResult {
  if (error instanceof TableLockedError) {
    return { success: false, error: error.message, errorCode: 'locked', lock: error.lock }
  }
  if (error instanceof OrchestrationError) {
    return { success: false, error: error.message, errorCode: error.code }
  }
  return { success: false, error: 'Failed to update column', errorCode: 'internal' }
}

function fail(error: string, errorCode: OrchestrationErrorCode): PerformUpdateTableColumnResult {
  return { success: false, error, errorCode }
}

/**
 * Applies a column update — rename, type conversion, currency re-denomination,
 * option-set edit, and constraint change — as the single implementation behind
 * the UI route, the v1 and v2 public APIs, and the copilot table tool.
 *
 * Each underlying write is its own locked transaction, so a request that spans
 * several of them could commit one and then fail. Two things prevent that and
 * both are load-bearing: the guards below reject every knowable failure before
 * any write runs, and the rename and constraint changes ride *inside* the typed
 * write's transaction rather than following it. The caller owns authentication
 * and workspace scoping; by the time this runs, `table` is one the actor may write.
 */
export async function performUpdateTableColumn(
  params: PerformUpdateTableColumnParams
): Promise<PerformUpdateTableColumnResult> {
  const { table, columnName, userId, updates, request } = params
  const requestId = params.requestId ?? generateRequestId()
  const tableId = table.id

  const currentColumn = table.schema.columns.find((c) => columnMatchesRef(c, columnName))
  if (!currentColumn) {
    return fail(`Column "${columnName}" not found`, 'not_found')
  }

  // Address every write by the stable id, not the name: a rename folded into
  // one of them must not break the next one's lookup.
  const columnRef = getColumnId(currentColumn)
  const existingOptions: SelectOption[] = currentColumn.options ?? []
  const options = normalizeSelectOptionsInput(updates.options, existingOptions)

  // A payload that repeats the current type must not go through
  // `updateColumnType` — it early-returns on an unchanged type and would drop
  // any options alongside it. Only a real type change routes there.
  const typeChanging = updates.type !== undefined && updates.type !== currentColumn.type

  // A retype applies and validates the constraints itself, so the separate
  // constraint write only runs when no typed write does. The rename rides
  // whichever write actually runs last.
  const typedWriteRuns =
    typeChanging ||
    updates.currencyCode !== undefined ||
    updates.referenceTableId !== undefined ||
    options !== undefined ||
    updates.multiple !== undefined
  const constraintsWriteRuns =
    !typedWriteRuns && (updates.required !== undefined || updates.unique !== undefined)
  const renameWithTypedWrite =
    updates.name && !constraintsWriteRuns ? { newName: updates.name } : {}

  // Gate on the type the column ENDS UP with, not on whether the type is
  // changing: an options-only update on an existing select column carries the
  // same hazard as a conversion does.
  const resultingType = updates.type ?? currentColumn.type

  if (updates.currencyCode !== undefined) {
    if (resultingType !== 'currency') {
      return fail(
        `Cannot set currency on column "${columnName}" of type "${resultingType}"`,
        'validation'
      )
    }
    if (!isSupportedCurrencyCode(updates.currencyCode)) {
      return fail(
        `Invalid currency code "${updates.currencyCode}". Use an ISO 4217 code, e.g. USD`,
        'validation'
      )
    }
  }
  if (updates.referenceTableId !== undefined && resultingType !== 'reference') {
    return fail(
      `Cannot set a reference table on column "${columnName}" of type "${resultingType}"`,
      'validation'
    )
  }
  // The rename runs last, so a name already taken would fail after the typed
  // write committed. This is the only rename failure a caller can cause;
  // catching it here leaves just the concurrent-collision race.
  if (
    updates.name &&
    table.schema.columns.some(
      (c) =>
        c.name.toLowerCase() === updates.name?.toLowerCase() && !columnMatchesRef(c, columnName)
    )
  ) {
    return fail(`Column "${updates.name}" already exists`, 'validation')
  }
  if (
    currentColumn.workflowGroupId &&
    (updates.required !== undefined || updates.unique !== undefined)
  ) {
    return fail(
      `Cannot change constraints on workflow-output column "${currentColumn.name}". Constraints aren't applicable to columns whose values come from workflow execution.`,
      'validation'
    )
  }
  if (updates.unique === true && !columnTypeById(resultingType).supportsUnique) {
    return fail(`Cannot set a ${resultingType} column as unique`, 'validation')
  }

  let updated: TableDefinition | undefined

  try {
    if (typeChanging) {
      updated = await updateColumnType(
        {
          tableId,
          columnName: columnRef,
          newType: updates.type as ColumnType,
          ...(options !== undefined ? { options } : {}),
          ...(updates.multiple !== undefined ? { multiple: updates.multiple } : {}),
          ...(updates.currencyCode !== undefined ? { currencyCode: updates.currencyCode } : {}),
          ...(updates.referenceTableId !== undefined
            ? { referenceTableId: updates.referenceTableId }
            : {}),
          // Forwarded so the conversion validates against the constraints this
          // same request is about to set, not the column's current ones.
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
          ...renameWithTypedWrite,
        },
        requestId,
        ...workspaceMutationOptions(params.expectedWorkspaceId)
      )
    } else if (updates.currencyCode !== undefined) {
      // Re-denominating an existing currency column: schema-only, no cell
      // rewrite. Reached only when the type is unchanged — a conversion INTO
      // currency carries the code through `updateColumnType` above.
      updated = await updateColumnCurrency(
        {
          tableId,
          columnName: columnRef,
          currencyCode: updates.currencyCode,
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
          ...renameWithTypedWrite,
        },
        requestId,
        ...workspaceMutationOptions(params.expectedWorkspaceId)
      )
    } else if (updates.referenceTableId !== undefined) {
      updated = await updateColumnReference(
        {
          tableId,
          columnName: columnRef,
          referenceTableId: updates.referenceTableId,
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
          ...renameWithTypedWrite,
        },
        requestId,
        ...workspaceMutationOptions(params.expectedWorkspaceId)
      )
    } else if (options !== undefined || updates.multiple !== undefined) {
      updated = await updateColumnOptions(
        {
          tableId,
          columnName: columnRef,
          options: options ?? existingOptions,
          ...(updates.multiple !== undefined ? { multiple: updates.multiple } : {}),
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
          ...renameWithTypedWrite,
        },
        requestId,
        ...workspaceMutationOptions(params.expectedWorkspaceId)
      )
    }

    // Skipped whenever a typed write ran: that write already applied and
    // validated these, in one transaction with the change they accompany.
    if (constraintsWriteRuns) {
      updated = await updateColumnConstraints(
        {
          tableId,
          columnName: columnRef,
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
          ...(updates.name ? { newName: updates.name } : {}),
        },
        requestId,
        ...workspaceMutationOptions(params.expectedWorkspaceId)
      )
    }

    // A rename rides along with the LAST write above, inside that write's
    // transaction — a rename is metadata-only (rows key on the stable column
    // id), so nothing forces it to be its own write, and folding it in is what
    // stops a combined request from committing one half and then failing. Only
    // a rename with nothing to ride on runs standalone.
    if (updates.name && !updated) {
      updated = await renameColumn(
        { tableId, oldName: columnRef, newName: updates.name },
        requestId,
        ...workspaceMutationOptions(params.expectedWorkspaceId)
      )
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to update column "${columnName}" on table ${tableId}`, {
      error,
    })
    return classify(error)
  }

  if (!updated) {
    // A payload whose only content is the type the column already has names a
    // change and asks for nothing. Say which, the way `updateColumnType` does
    // when it loses the same race, rather than claiming the request was empty.
    if (updates.type !== undefined) {
      return fail(
        `Column "${currentColumn.name}" is already type "${currentColumn.type}"; re-issue the request without a type change.`,
        'validation'
      )
    }
    return fail('No updates specified', 'validation')
  }

  if (params.recordAudit !== false) {
    recordAudit({
      workspaceId: table.workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: tableId,
      resourceName: table.name,
      description: `Updated column "${columnName}" in table "${table.name}"`,
      metadata: { columnName, updates },
      ...(request ? { request } : {}),
    })
  }

  return { success: true, table: updated }
}
