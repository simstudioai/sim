'use client'

import { useId, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import {
  Checkbox,
  ChipCombobox,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  DatePicker,
  Label,
} from '@/components/emcn'
import type { ColumnDefinition, TableInfo, TableRow } from '@/lib/table'
import { getColumnStorageType } from '@/lib/table/constants'
import { useDeleteTableRow, useDeleteTableRows, useUpdateTableRow } from '@/hooks/queries/tables'
import { cleanCellValue, formatValueForInput } from '../../utils'

const logger = createLogger('RowModal')

export interface RowModalProps {
  mode: 'edit' | 'delete'
  isOpen: boolean
  onClose: () => void
  table: TableInfo
  row?: TableRow
  rowIds?: string[]
  onSuccess: () => void
}

function cleanRowData(
  columns: ColumnDefinition[],
  rowData: Record<string, unknown>
): Record<string, unknown> {
  const cleanData: Record<string, unknown> = {}

  columns.forEach((col) => {
    const value = rowData[col.name]
    try {
      cleanData[col.name] = cleanCellValue(value, col)
    } catch {
      throw new Error(`Invalid JSON for field: ${col.name}`)
    }
  })

  return cleanData
}

/**
 * Modal for editing a row's values or confirming row deletion.
 *
 * `rowData` is initialized from the `row` prop at mount time only. Both call-sites
 * conditionally mount this component per open, so each open gets fresh state. If a
 * call-site ever keeps it mounted across target-row changes, it must supply a `key`
 * prop (e.g. the row id) so React remounts with the new row's values.
 */
export function RowModal({ mode, isOpen, onClose, table, row, rowIds, onSuccess }: RowModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const tableId = table.id

  const schema = table?.schema
  const columns = schema?.columns || []

  const [rowData, setRowData] = useState<Record<string, unknown>>(() =>
    mode === 'edit' && row ? row.data : {}
  )
  const [error, setError] = useState<string | null>(null)
  const updateRowMutation = useUpdateTableRow({ workspaceId, tableId })
  const deleteRowMutation = useDeleteTableRow({ workspaceId, tableId })
  const deleteRowsMutation = useDeleteTableRows({ workspaceId, tableId })
  const isSubmitting =
    updateRowMutation.isPending || deleteRowMutation.isPending || deleteRowsMutation.isPending

  const handleFormSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(null)

    try {
      const cleanData = cleanRowData(columns, rowData)

      if (row) {
        await updateRowMutation.mutateAsync({ rowId: row.id, data: cleanData })
      }

      onSuccess()
    } catch (err) {
      logger.error('Failed to edit row:', err)
      setError(getErrorMessage(err, 'Failed to edit row'))
    }
  }

  const handleDelete = async () => {
    setError(null)

    const idsToDelete = rowIds ?? (row ? [row.id] : [])

    try {
      if (idsToDelete.length === 1) {
        await deleteRowMutation.mutateAsync(idsToDelete[0])
      } else {
        await deleteRowsMutation.mutateAsync(idsToDelete)
      }

      onSuccess()
    } catch (err) {
      logger.error('Failed to delete row(s):', err)
      setError(getErrorMessage(err, 'Failed to delete row(s)'))
    }
  }

  const handleClose = () => {
    setError(null)
    onClose()
  }

  if (mode === 'delete') {
    const deleteCount = rowIds?.length ?? (row ? 1 : 0)
    const isSingleRow = deleteCount === 1

    return (
      <ChipConfirmModal
        open={isOpen}
        onOpenChange={handleClose}
        srTitle={`Delete ${isSingleRow ? 'Row' : `${deleteCount} Rows`}`}
        title={`Delete ${isSingleRow ? 'Row' : `${deleteCount} Rows`}`}
        text={[
          `Are you sure you want to delete ${isSingleRow ? 'this row' : `these ${deleteCount} rows`}? `,
          {
            text: `This will permanently remove all data in ${isSingleRow ? 'this row' : 'these rows'}.`,
            error: true,
          },
          ' This action cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDelete,
          pending: isSubmitting,
          pendingLabel: 'Deleting...',
        }}
      >
        <ChipModalError>{error}</ChipModalError>
      </ChipConfirmModal>
    )
  }

  return (
    <ChipModal open={isOpen} onOpenChange={handleClose} srTitle='Edit Row' size='lg'>
      <ChipModalHeader onClose={handleClose}>Edit Row</ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-tertiary)] text-small'>
          Update values for {table?.name ?? 'table'}
        </p>
        <form onSubmit={handleFormSubmit} className='contents'>
          <button type='submit' hidden disabled={isSubmitting} />
          {columns.map((column) => (
            <ColumnField
              key={column.name}
              column={column}
              value={rowData[column.name]}
              onChange={(value) => setRowData((prev) => ({ ...prev, [column.name]: value }))}
            />
          ))}
        </form>
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={handleClose}
        cancelDisabled={isSubmitting}
        primaryAction={{
          label: isSubmitting ? 'Updating...' : 'Update Row',
          onClick: () => handleFormSubmit(),
          disabled: isSubmitting,
        }}
      />
    </ChipModal>
  )
}

interface ColumnFieldProps {
  column: ColumnDefinition
  value: unknown
  onChange: (value: unknown) => void
}

function ColumnField({ column, value, onChange }: ColumnFieldProps) {
  const checkboxId = useId()
  const title = (
    <>
      {column.name}
      {column.unique && (
        <span className='ml-1.5 font-normal text-[var(--text-tertiary)] text-xs'>(unique)</span>
      )}
    </>
  )
  const hint = `Type: ${column.type}${column.required ? '' : ' (optional)'}`

  if (column.type === 'boolean') {
    return (
      <ChipModalField type='custom' title={title} required={column.required} hint={hint}>
        <div className='flex items-center gap-2'>
          <Checkbox
            id={checkboxId}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <Label
            htmlFor={checkboxId}
            className='font-normal text-[var(--text-tertiary)] text-small'
          >
            {value ? 'True' : 'False'}
          </Label>
        </div>
      </ChipModalField>
    )
  }

  if (column.type === 'json') {
    return (
      <ChipModalField
        type='textarea'
        title={title}
        required={column.required}
        hint={hint}
        mono
        value={formatValueForInput(value, column.type)}
        onChange={onChange}
        placeholder='{"key": "value"}'
        rows={4}
      />
    )
  }

  if (column.type === 'date') {
    return (
      <ChipModalField type='custom' title={title} required={column.required} hint={hint}>
        <DatePicker
          mode='single'
          value={formatValueForInput(value, column.type) || undefined}
          onChange={(dateStr) => onChange(dateStr)}
          placeholder='Select date'
        />
      </ChipModalField>
    )
  }

  if (column.type === 'select') {
    const options = column.options ?? []
    const current = typeof value === 'string' ? value : ''
    // Match the stored value case-insensitively (same as the grid's tag
    // rendering) so a casing variant selects its canonical option instead of
    // appearing as a duplicate entry.
    const matched = options.find((option) => option.toLowerCase() === current.toLowerCase())
    const selectOptions = [
      ...options.map((option) => ({ label: option, value: option })),
      ...(current && matched === undefined ? [{ label: current, value: current }] : []),
    ]
    return (
      <ChipModalField type='custom' title={title} required={column.required} hint={hint}>
        <ChipCombobox
          options={selectOptions}
          value={matched ?? current}
          onChange={(v) => onChange(v)}
          placeholder='Select option'
          maxHeight={260}
        />
      </ChipModalField>
    )
  }

  if (column.type === 'email') {
    return (
      <ChipModalField
        type='email'
        title={title}
        required={column.required}
        hint={hint}
        value={formatValueForInput(value, column.type)}
        onChange={onChange}
        placeholder={`Enter ${column.name}`}
      />
    )
  }

  const inputType =
    getColumnStorageType(column.type) === 'number'
      ? 'number'
      : (FIELD_INPUT_TYPES[column.type] ?? 'text')

  return (
    <ChipModalField
      type='input'
      title={title}
      required={column.required}
      hint={hint}
      inputType={inputType}
      value={formatValueForInput(value, column.type)}
      onChange={onChange}
      placeholder={`Enter ${column.name}`}
    />
  )
}

/** Browser input types for rich string-backed columns (default: `text`). */
const FIELD_INPUT_TYPES: Partial<Record<ColumnDefinition['type'], 'url' | 'tel'>> = {
  url: 'url',
  phone: 'tel',
}
