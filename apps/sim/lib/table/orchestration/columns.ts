import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { columnMatchesRef } from '@/lib/table/column-keys'
import {
  renameColumn,
  updateColumnConstraints,
  updateColumnOptions,
  updateColumnType,
} from '@/lib/table/columns/service'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { normalizeSelectOptionsInput } from '@/lib/table/select-options'
import type { ColumnType, SelectOption, TableDefinition } from '@/lib/table/types'

const logger = createLogger('TableColumnOrchestration')

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
  }
  requestId?: string
}

export interface PerformUpdateTableColumnResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  table?: TableDefinition
}

/**
 * Messages the column services raise for caller-fixable problems. They are
 * thrown as plain `Error`s, so the classification lives here rather than being
 * re-derived by each route.
 */
const VALIDATION_MESSAGE_FRAGMENTS = [
  'already exists',
  'Cannot delete the last column',
  'Cannot set column',
  'Cannot set unique column',
  'Invalid column',
  'exceeds maximum',
  'incompatible',
  'duplicate',
  'option',
] as const

function classify(error: unknown): PerformUpdateTableColumnResult {
  if (error instanceof TableLockedError) {
    return { success: false, error: error.message, errorCode: 'locked' }
  }
  if (error instanceof Error) {
    const message = error.message
    if (message.includes('not found') || message.includes('Table not found')) {
      return { success: false, error: message, errorCode: 'not_found' }
    }
    if (VALIDATION_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment))) {
      return { success: false, error: message, errorCode: 'validation' }
    }
  }
  return { success: false, error: 'Failed to update column', errorCode: 'internal' }
}

/**
 * Applies a column update — rename, type conversion, option-set edit, and
 * constraint change — as the single implementation behind the UI route, the v1
 * and v2 public APIs, and the copilot table tool.
 *
 * Each underlying write is its own locked transaction, so the ordering and the
 * two guards below are load-bearing: they exist to stop a partially-applied
 * schema change, and previously lived in (and drifted between) four callers.
 * The caller owns authentication and workspace scoping; by the time this runs,
 * `table` is a table the actor may write.
 */
export async function performUpdateTableColumn(
  params: PerformUpdateTableColumnParams
): Promise<PerformUpdateTableColumnResult> {
  const { table, columnName, userId, updates } = params
  const requestId = params.requestId ?? generateRequestId()
  const tableId = table.id

  const currentColumn = table.schema.columns.find((c) => columnMatchesRef(c, columnName))
  const existingOptions: SelectOption[] = currentColumn?.options ?? []
  const options = normalizeSelectOptionsInput(updates.options, existingOptions)

  // A payload that repeats the current type must not go through
  // `updateColumnType` — it early-returns on an unchanged type and would drop
  // any options alongside it. Only a real type change routes there; an
  // unchanged type with options routes to the options-only update.
  const typeChanging = updates.type !== undefined && updates.type !== currentColumn?.type

  // Gate on the type the column ENDS UP with, not on whether the type is
  // changing: an options-only update on an existing select column carries the
  // same hazard as a conversion does.
  const resultingType = updates.type ?? currentColumn?.type
  if (updates.unique === true && resultingType === 'select') {
    return {
      success: false,
      error: `Cannot set column "${columnName}" as unique: select columns cannot be unique.`,
      errorCode: 'validation',
    }
  }

  const targetName = updates.name ?? columnName
  let updated: TableDefinition | undefined

  try {
    if (updates.name) {
      updated = await renameColumn(
        { tableId, oldName: columnName, newName: updates.name },
        requestId
      )
    }

    if (typeChanging) {
      updated = await updateColumnType(
        {
          tableId,
          columnName: targetName,
          newType: updates.type as ColumnType,
          ...(options !== undefined ? { options } : {}),
          ...(updates.multiple !== undefined ? { multiple: updates.multiple } : {}),
          // Forwarded so the conversion validates against the constraint this
          // same request is about to set, not the column's current one.
          ...(updates.required !== undefined ? { required: updates.required } : {}),
        },
        requestId
      )
    } else if (options !== undefined || updates.multiple !== undefined) {
      // `multiple` alone is a valid update, so fall back to the column's current
      // options rather than demanding the caller resend the whole list.
      const nextOptions = options ?? existingOptions
      if (nextOptions.length === 0) {
        return {
          success: false,
          error: `Column "${columnName}" is not a select column. Pass type "select" with options to convert it.`,
          errorCode: 'validation',
        }
      }
      updated = await updateColumnOptions(
        {
          tableId,
          columnName: targetName,
          options: nextOptions,
          ...(updates.multiple !== undefined ? { multiple: updates.multiple } : {}),
          // Forwarded so the removal guard validates against the constraint this
          // same request is about to set, not the column's current one.
          ...(updates.required !== undefined ? { required: updates.required } : {}),
        },
        requestId
      )
    }

    if (updates.required !== undefined || updates.unique !== undefined) {
      updated = await updateColumnConstraints(
        {
          tableId,
          columnName: targetName,
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
        },
        requestId
      )
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to update column "${columnName}" on table ${tableId}`, {
      error,
    })
    return classify(error)
  }

  if (!updated) {
    return { success: false, error: 'No updates specified', errorCode: 'validation' }
  }

  recordAudit({
    workspaceId: table.workspaceId,
    actorId: userId,
    action: AuditAction.TABLE_UPDATED,
    resourceType: AuditResourceType.TABLE,
    resourceId: tableId,
    resourceName: table.name,
    description: `Updated column "${columnName}" in table "${table.name}"`,
    metadata: { columnName, updates },
  })

  return { success: true, table: updated }
}
