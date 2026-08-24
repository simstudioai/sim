'use client'

import { useState } from 'react'
import { Button, ChipCombobox, cn, FieldDivider, Label, Switch, toast } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { toError } from '@sim/utils/errors'
import { useIsMutating } from '@tanstack/react-query'
import { isValidationError } from '@/lib/api/client/errors'
import type { ColumnDefinition, SelectOption } from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
import { getCurrencyOptions, resolveCurrencyCode } from '@/lib/table/currency'
import {
  FieldError,
  RequiredLabel,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/sidebar-fields'
import { useUpdateColumn } from '@/hooks/queries/tables'
import { tableKeys } from '@/hooks/queries/utils/table-keys'
import { SelectOptionsEditor } from '../select-field'

/**
 * Picker entries, built once at module load: the option list is derived from the
 * runtime's currency data and never varies per column.
 */
const CURRENCY_COMBOBOX_OPTIONS = getCurrencyOptions().map((c) => ({
  value: c.code,
  label: `${c.code} · ${c.name}`,
}))

function optionsEqual(a: SelectOption[], b: SelectOption[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Discriminates the flows the column-config sidebar handles. Name and type
 * never appear here — renaming is inline in the header and type changes go
 * through the header menu's "Change type" submenu. Workflow configuration is a
 * separate component (`<WorkflowSidebar>`).
 */
export type ColumnConfig =
  /**
   * A select column being created: its name has been committed in the grid
   * header, but it exists only as a draft there until Save hands the option
   * set to the creator, which persists name and options in one create.
   * Dismissing discards the draft.
   */
  | { mode: 'draft-select' }
  /**
   * Convert an existing column to select: Save applies the type change
   * together with the configured options; dismissing leaves the column's
   * current type untouched.
   */
  | { mode: 'convert-select'; columnName: string }
  /** Edit the configuration of an existing select or currency column. */
  | { mode: 'configure'; columnName: string }

interface ColumnConfigSidebarProps {
  /** When non-null the sidebar is open. */
  config: ColumnConfig | null
  onClose: () => void
  /**
   * `draft-select` Save: hands the validated option set to the draft's owner,
   * which persists the column. Resolves `true` once created (the parent then
   * closes the sidebar) or `false` to stay open — the draft's name was refused
   * or the create failed, and the owner has already surfaced why.
   */
  onDraftSave: (options: SelectOption[], multiple: boolean) => Promise<boolean>
  onColumnTypeChange: (
    columnName: string,
    previousColumn: ColumnDefinition,
    newColumn: ColumnDefinition
  ) => void
  /** Existing column record for modes that carry a `columnName`; otherwise null. */
  existingColumn: ColumnDefinition | null
  workspaceId: string
  tableId: string
}

/**
 * Right-edge sidebar for per-type column configuration: a select's option set
 * and a currency's display code. Everything else about a column — name, type,
 * unique — is edited in the grid header and its menu.
 *
 * Form state seeds from props via lazy `useState` initializers; the body is
 * keyed on the config identity so opening a different column or mode remounts
 * and re-seeds.
 */
export function ColumnConfigSidebar(props: ColumnConfigSidebarProps) {
  const open = props.config !== null
  return (
    <aside
      role='dialog'
      aria-label='Configure column'
      className={cn(
        'absolute top-0 right-0 bottom-0 z-[var(--z-modal)] flex w-[400px] flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)] transition-transform duration-200 ease-out',
        open ? 'translate-x-0 shadow-overlay' : 'translate-x-full'
      )}
    >
      {props.config && (
        <ColumnConfigBody key={configKey(props.config)} {...props} config={props.config} />
      )}
    </aside>
  )
}

function configKey(config: ColumnConfig): string {
  return config.mode === 'draft-select' ? 'draft-select' : `${config.mode}:${config.columnName}`
}

interface ColumnConfigBodyProps extends Omit<ColumnConfigSidebarProps, 'config'> {
  config: ColumnConfig
}

function ColumnConfigBody({
  config,
  onClose,
  onDraftSave,
  onColumnTypeChange,
  existingColumn,
  workspaceId,
  tableId,
}: ColumnConfigBodyProps) {
  const updateColumn = useUpdateColumn({ workspaceId, tableId })
  const draftSaving = useIsMutating({ mutationKey: tableKeys.columnWrites(tableId) }) > 0

  const isSelectTarget = config.mode !== 'configure' || existingColumn?.type === 'select'
  const isCurrencyTarget = config.mode === 'configure' && existingColumn?.type === 'currency'

  const [optionsInput, setOptionsInput] = useState<SelectOption[]>(
    () => existingColumn?.options ?? []
  )
  const [multipleInput, setMultipleInput] = useState<boolean>(() => !!existingColumn?.multiple)
  const [currencyInput, setCurrencyInput] = useState<string>(() =>
    resolveCurrencyCode(existingColumn?.currencyCode)
  )
  const [optionsError, setOptionsError] = useState<string | null>(null)

  const saveDisabled = updateColumn.isPending || draftSaving
  const trimmedOptions = optionsInput.map((o) => ({ ...o, name: o.name.trim() }))

  /** Client-side option validation mirroring the server rules; returns an error message or null. */
  function validateOptions(): string | null {
    if (!isSelectTarget) return null
    if (trimmedOptions.length === 0) return 'Add at least one option'
    if (trimmedOptions.some((o) => !o.name)) return 'Option names cannot be empty'
    const names = trimmedOptions.map((o) => o.name.toLowerCase())
    if (new Set(names).size !== names.length) return 'Option names must be unique'
    return null
  }

  async function handleSave() {
    const optionsIssue = validateOptions()
    if (optionsIssue) {
      setOptionsError(optionsIssue)
      return
    }
    if (config.mode === 'draft-select') {
      // The draft's owner persists name + options together and reports back;
      // the parent closes the sidebar on success, so nothing to do here.
      await onDraftSave(trimmedOptions, multipleInput)
      return
    }

    const columnLabel = existingColumn?.name ?? config.columnName

    try {
      if (config.mode === 'convert-select') {
        const result = await updateColumn.mutateAsync({
          columnName: config.columnName,
          updates: {
            type: 'select',
            options: trimmedOptions,
            ...(multipleInput ? { multiple: true } : {}),
            // Select columns can't carry a unique constraint (the header-menu
            // toggle is hidden for them), so converting a unique column would
            // strand the constraint with no way to clear it.
            ...(existingColumn?.unique ? { unique: false } : {}),
          },
        })
        if (existingColumn) {
          const updatedColumn = result.data.columns.find(
            (candidate) => getColumnId(candidate) === config.columnName
          ) ?? {
            ...existingColumn,
            type: 'select',
            options: trimmedOptions,
            unique: false,
            ...(multipleInput ? { multiple: true } : {}),
          }
          onColumnTypeChange(config.columnName, existingColumn, updatedColumn)
        }
        toast.success(`Saved "${columnLabel}"`)
        onClose()
        return
      }

      if (isCurrencyTarget) {
        const currencyChanged = resolveCurrencyCode(existingColumn?.currencyCode) !== currencyInput
        if (currencyChanged) {
          await updateColumn.mutateAsync({
            columnName: config.columnName,
            updates: { currencyCode: currencyInput },
          })
          toast.success(`Saved "${columnLabel}"`)
        }
        onClose()
        return
      }

      const optionsChanged = !optionsEqual(existingColumn?.options ?? [], trimmedOptions)
      const multipleChanged = !!existingColumn?.multiple !== multipleInput
      if (!optionsChanged && !multipleChanged) {
        onClose()
        return
      }
      await updateColumn.mutateAsync({
        columnName: config.columnName,
        updates: {
          ...(optionsChanged ? { options: trimmedOptions } : {}),
          ...(multipleChanged ? { multiple: multipleInput } : {}),
        },
      })
      toast.success(`Saved "${columnLabel}"`)
      onClose()
    } catch (err) {
      if (isValidationError(err)) {
        toast.error(toError(err).message)
      }
    }
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex min-h-[48px] items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
        <h2 className='text-[var(--text-primary)] text-small'>Configure column</h2>
        <Button
          variant='ghost'
          size='sm'
          onClick={onClose}
          disabled={saveDisabled}
          className='!p-1 size-7'
          aria-label='Close'
        >
          <X className='size-[14px]' />
        </Button>
      </div>

      <div className='flex-1 overflow-y-auto overflow-x-hidden px-2 pt-3 pb-2 [overflow-anchor:none]'>
        {isCurrencyTarget && (
          <div className='flex flex-col gap-[9.5px]'>
            <RequiredLabel>Currency</RequiredLabel>
            <ChipCombobox
              options={CURRENCY_COMBOBOX_OPTIONS}
              value={currencyInput}
              onChange={setCurrencyInput}
              placeholder='Select currency'
              searchable
              searchPlaceholder='Search currencies'
              maxHeight={260}
            />
          </div>
        )}

        {isSelectTarget && (
          <>
            <div className='flex flex-col gap-[9.5px]'>
              <RequiredLabel>Options</RequiredLabel>
              <SelectOptionsEditor
                options={optionsInput}
                onChange={(next) => {
                  setOptionsInput(next)
                  if (optionsError) setOptionsError(null)
                }}
              />
              {optionsError && <FieldError message={optionsError} />}
            </div>
            <FieldDivider />
            <div className='flex items-center justify-between pl-0.5'>
              <Label htmlFor='column-sidebar-multiple'>Multiselect</Label>
              <Switch
                id='column-sidebar-multiple'
                checked={multipleInput}
                onCheckedChange={(v) => setMultipleInput(!!v)}
              />
            </div>
          </>
        )}
      </div>

      <div className='flex items-center justify-end gap-2 border-[var(--border)] border-t px-2 py-3'>
        <Button variant='default' size='sm' onClick={onClose} disabled={saveDisabled}>
          Cancel
        </Button>
        <Button variant='primary' size='sm' onClick={handleSave} disabled={saveDisabled}>
          {saveDisabled ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
