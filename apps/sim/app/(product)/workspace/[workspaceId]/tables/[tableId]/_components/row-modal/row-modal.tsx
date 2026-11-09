'use client'

import { useRef, useState } from 'react'
import { Checkbox } from '@sim/emcn/checkbox'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { DatePicker } from '@sim/emcn/picker/date-picker'
import { getErrorMessage } from '@sim/utils/errors'
import styles from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/row-modal/row-modal.module.css'
import { SelectValueEditor } from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/select-field/select-field'
import {
  type ColumnDefinition,
  cleanCellValue,
  columnTypeOf,
  dateValueToLocalParts,
  formatValueForInput,
  getColumnId,
  getTimezoneEditBlockedMessage,
  isEmptyCellValue,
  localPartsToDateValue,
  type RowInsertTarget,
  resolveCurrencyCode,
  type TableDefinition,
  type TableRow,
  type TimezoneState,
  todayAtTtlOffset,
  todayLocalCalendarDate,
  ttlValueFromPicker,
  ttlValueToPickerParts,
  useCreateTableRow,
  useDeleteTableRow,
  useDeleteTableRows,
  useTimezoneState,
  useUpdateTableRow,
} from '@/platform/lib/data/tables'

interface RowModalProps {
  mode: 'add' | 'edit' | 'delete'
  isOpen: boolean
  /** Dismisses the dialog; it also runs after `onSuccess`, once a write lands and the dialog closes. */
  onClose: () => void
  table: Pick<TableDefinition, 'id' | 'name' | 'schema' | 'workspaceId'>
  row?: TableRow
  rowIds?: string[]
  /** Where add mode inserts the row; it appends when omitted. */
  insertAt?: RowInsertTarget
  onSuccess: () => void
}

/** Structural equality for a cleaned cell value against what the row already holds. */
function cellValueUnchanged(next: unknown, previous: unknown): boolean {
  if (next === previous) return true
  const nextEmpty = next === null || next === undefined
  const previousEmpty = previous === null || previous === undefined
  if (nextEmpty || previousEmpty) return nextEmpty && previousEmpty
  if (typeof next === 'object' || typeof previous === 'object') {
    return JSON.stringify(next) === JSON.stringify(previous)
  }
  return false
}

/**
 * Builds the write payload. Only fields the user touched are sent, so an untouched empty column
 * stays absent instead of being written as `null`, and in edit mode an unchanged field is dropped
 * too, leaving a no-op save with nothing to write. Toggles are the exception on insert: they always
 * carry a concrete boolean, so a required checkbox the user never clicked still reaches the server
 * as `false`. Date columns are skipped while the viewer's timezone cannot be trusted.
 */
function cleanRowData(
  columns: ColumnDefinition[],
  rowData: Record<string, unknown>,
  timeZone: string,
  dateEditorsReady: boolean,
  options: { mode: 'add' | 'edit'; baseline?: Record<string, unknown> }
): Record<string, unknown> {
  const cleanData: Record<string, unknown> = {}

  for (const column of columns) {
    const columnId = getColumnId(column)
    const definition = columnTypeOf(column)
    if (definition.editor === 'date' && !dateEditorsReady) continue
    const touched = columnId in rowData
    const alwaysSend = options.mode === 'add' && definition.editor === 'toggle'
    if (!touched && !alwaysSend) continue
    let cleaned: unknown
    try {
      cleaned = cleanCellValue(rowData[columnId], column, timeZone)
    } catch {
      throw new Error(`Invalid JSON for field: ${column.name}`)
    }
    if (options.baseline && cellValueUnchanged(cleaned, options.baseline[columnId])) continue
    cleanData[columnId] = cleaned
  }

  return cleanData
}

function columnFieldHint(column: ColumnDefinition): string {
  const typeLabel =
    column.type === 'currency'
      ? `currency (${resolveCurrencyCode(column.currencyCode)})`
      : column.type
  return `Type: ${typeLabel}${column.unique ? ' (unique)' : ''}`
}

/**
 * Adds a complete row, edits a row's values, or confirms deleting rows. Adding inserts every value
 * in one request, so it works on a table whose update lock blocks filling in a blank row from the
 * grid. A failed write, a lock refusal (423) included, keeps the draft and shows its reason in the
 * dialog rather than as a toast.
 *
 * The draft seeds from `row` when the dialog mounts, so the page mounts it per open (or keys it on
 * the row) to give each open fresh values.
 */
export function RowModal({
  mode,
  isOpen,
  onClose,
  table,
  row,
  rowIds,
  insertAt,
  onSuccess,
}: RowModalProps) {
  const workspaceId = table.workspaceId
  const tableId = table.id
  const columns = table.schema.columns

  // A date is edited in the zone the dialog opened with: a timezone change mid-edit must not
  // reinterpret what the viewer already picked.
  const timezoneState = useTimezoneState()
  const editTimeZoneRef = useRef<string | null>(null)
  if (timezoneState.status === 'ready' && editTimeZoneRef.current === null) {
    editTimeZoneRef.current = timezoneState.timezone
  }
  const dateEditorsReady = editTimeZoneRef.current !== null
  const timeZone = editTimeZoneRef.current ?? timezoneState.timezone

  const [rowData, setRowData] = useState<Record<string, unknown>>(() =>
    mode === 'edit' && row ? row.data : {}
  )
  // The dialog shows a failure itself, so the mutations skip the toast that would repeat it.
  const mutationContext = { workspaceId, tableId, suppressErrorToast: true }
  const createRowMutation = useCreateTableRow(mutationContext)
  const updateRowMutation = useUpdateTableRow(mutationContext)
  const deleteRowMutation = useDeleteTableRow(mutationContext)
  const deleteRowsMutation = useDeleteTableRows(mutationContext)
  const isSubmitting =
    createRowMutation.isPending ||
    updateRowMutation.isPending ||
    deleteRowMutation.isPending ||
    deleteRowsMutation.isPending
  const isAddMode = mode === 'add'

  if (mode === 'delete') {
    const idsToDelete = rowIds ?? (row ? [row.id] : [])
    const deleteCount = rowIds?.length ?? (row ? 1 : 0)
    const isSingleRow = deleteCount === 1

    return (
      <ConfirmDialog
        target={isOpen ? idsToDelete : null}
        onClose={onClose}
        title={`Delete ${isSingleRow ? 'Row' : `${deleteCount} Rows`}`}
        description={`Are you sure you want to delete ${isSingleRow ? 'this row' : `these ${deleteCount} rows`}? This will permanently remove all data in ${isSingleRow ? 'this row' : 'these rows'}. This action cannot be undone.`}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        pending={isSubmitting}
        onConfirm={async (ids) => {
          try {
            if (ids.length === 1) await deleteRowMutation.mutateAsync(ids[0])
            else await deleteRowsMutation.mutateAsync(ids)
          } catch (error) {
            throw new Error(getErrorMessage(error, 'Failed to delete row(s)'))
          }
          onSuccess()
        }}
      />
    )
  }

  const timezoneBlockedMessage = getTimezoneEditBlockedMessage(timezoneState)
  const hasEditableColumn = columns.some(
    (column) => columnTypeOf(column).editor !== 'date' || dateEditorsReady
  )
  /** Toggles always save a boolean, so only other required columns can be left empty. */
  const missingRequiredValue = columns.some(
    (column) =>
      column.required &&
      columnTypeOf(column).editor !== 'toggle' &&
      isEmptyCellValue(rowData[getColumnId(column)])
  )
  const canSubmit = hasEditableColumn && !missingRequiredValue

  async function handleSubmit() {
    if (!canSubmit) return false
    const action = isAddMode ? 'add' : 'edit'
    try {
      const cleanData = cleanRowData(columns, rowData, timeZone, dateEditorsReady, {
        mode: action,
        baseline: isAddMode ? undefined : row?.data,
      })
      if (isAddMode) {
        await createRowMutation.mutateAsync({ data: cleanData, ...insertAt })
      } else if (row && Object.keys(cleanData).length > 0) {
        // Nothing changed: close instead of writing an empty patch.
        await updateRowMutation.mutateAsync({ rowId: row.id, data: cleanData })
      }
    } catch (error) {
      throw new Error(getErrorMessage(error, `Failed to ${action} row`))
    }
    onSuccess()
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={isAddMode ? 'Add Row' : 'Edit Row'}
      description={`${isAddMode ? 'Fill in values for' : 'Update values for'} ${table.name || 'table'}`}
      confirmLabel={
        isAddMode
          ? isSubmitting
            ? 'Adding…'
            : 'Add Row'
          : isSubmitting
            ? 'Updating…'
            : 'Update Row'
      }
      confirmDisabled={!canSubmit}
      pending={isSubmitting}
      onConfirm={handleSubmit}
    >
      {columns.map((column) => {
        const columnId = getColumnId(column)
        return columnTypeOf(column).editor === 'date' && !dateEditorsReady ? (
          <TimezoneBlockedField
            key={columnId}
            column={column}
            value={rowData[columnId]}
            status={timezoneState.status}
            blockedMessage={timezoneBlockedMessage}
          />
        ) : (
          <ColumnField
            key={columnId}
            column={column}
            value={rowData[columnId]}
            timeZone={timeZone}
            onChange={(value) => setRowData((previous) => ({ ...previous, [columnId]: value }))}
          />
        )
      })}
    </Modal>
  )
}

interface TimezoneBlockedFieldProps {
  column: ColumnDefinition
  value: unknown
  status: TimezoneState['status']
  blockedMessage: string | null
}

/**
 * A date column the viewer cannot edit yet: its stored value, read-only, until the timezone setting
 * it is edited in can be trusted. Once the setting has failed or is invalid, the field says why
 * and what to do; while it is still being read, the field waits without saying anything.
 */
function TimezoneBlockedField({
  column,
  value,
  status,
  blockedMessage,
}: TimezoneBlockedFieldProps) {
  const rawValue =
    typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : JSON.stringify(value)
  return (
    <TextField
      label={column.name}
      optional={!column.required}
      hint={status !== 'loading' && blockedMessage ? blockedMessage : columnFieldHint(column)}
      placeholder='No value'
      value={rawValue}
      readOnly
    />
  )
}

interface ColumnFieldProps {
  column: ColumnDefinition
  value: unknown
  timeZone: string
  onChange: (value: unknown) => void
}

function ColumnField({ column, value, timeZone, onChange }: ColumnFieldProps) {
  const hint = columnFieldHint(column)
  const definition = columnTypeOf(column)

  if (definition.editor === 'toggle') {
    return (
      <Checkbox
        label={column.name}
        description={hint}
        checked={Boolean(value)}
        onCheckedChange={onChange}
      />
    )
  }

  // The one type that wants a multi-line field; `editor: 'text'` covers it and a plain input both.
  if (column.type === 'json') {
    return (
      <TextAreaField
        label={column.name}
        optional={!column.required}
        hint={hint}
        value={formatValueForInput(value, column.type)}
        onChange={onChange}
        placeholder='{"key": "value"}'
        spellCheck={false}
      />
    )
  }

  if (definition.editor === 'date' || definition.editor === 'offset-date') {
    return (
      <DateTimeField
        column={column}
        value={value}
        timeZone={timeZone}
        offset={definition.editor === 'offset-date'}
        hint={hint}
        onChange={onChange}
      />
    )
  }

  if (definition.editor === 'select') {
    return <SelectValueEditor column={column} value={value} onChange={onChange} hint={hint} />
  }

  return (
    <TextField
      label={column.name}
      optional={!column.required}
      hint={hint}
      // A native number input rejects the formatted amounts a formatted type's parser accepts, so
      // those types take a text field, as the grid's inline editor does.
      type={
        definition.inputMode === 'decimal' && !definition.acceptsFormattedInput ? 'number' : 'text'
      }
      value={formatValueForInput(value, column.type)}
      onChange={onChange}
      placeholder={`Enter ${column.name}`}
    />
  )
}

interface DateTimeFieldProps {
  column: ColumnDefinition
  value: unknown
  timeZone: string
  /** An expiration keeps the offset it was stored with; a date is stamped in the viewer's zone. */
  offset: boolean
  hint: string
  onChange: (value: unknown) => void
}

/**
 * A date or expiration as a calendar day and a time of day. Picking a day keeps the time already
 * set; setting a time before any day uses today, in the zone or offset the value is edited in.
 */
function DateTimeField({ column, value, timeZone, offset, hint, onChange }: DateTimeFieldProps) {
  const storedValue = formatValueForInput(value, column.type)
  const offsetParts = offset ? ttlValueToPickerParts(storedValue) : null
  const parts = offsetParts ?? dateValueToLocalParts(storedValue)
  const today = offsetParts
    ? todayAtTtlOffset(offsetParts.offset)
    : todayLocalCalendarDate(timeZone)
  const valueFromParts = (day: string, time: string | null) =>
    offsetParts
      ? ttlValueFromPicker(day, time, offsetParts.offset)
      : localPartsToDateValue(day, time, timeZone)

  return (
    <div className={styles.dateTime}>
      <DatePicker
        label={column.name}
        optional={!column.required}
        hint={hint}
        value={parts.day}
        onValueChange={(day) => {
          if (day) onChange(valueFromParts(day, parts.time))
        }}
        placeholder='Select date'
      />
      <TextField
        label={offsetParts ? `Time (${offsetParts.offset})` : 'Time'}
        type='time'
        placeholder='Select time'
        value={parts.time?.slice(0, 5) ?? ''}
        onChange={(time) => onChange(valueFromParts(parts.day ?? today, time || null))}
      />
    </div>
  )
}
