'use client'

import type React from 'react'
import { useState } from 'react'
import { toError } from '@sim/utils/errors'
import { X } from 'lucide-react'
import { Button, Combobox, FieldDivider, Input, Label, Switch, toast } from '@/components/emcn'
import { findValidationIssue, isValidationError } from '@/lib/api/client/errors'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition } from '@/lib/table'
import { useAddTableColumn, useUpdateColumn } from '@/hooks/queries/tables'
import { PLAIN_COLUMN_TYPE_OPTIONS } from './column-types'

/**
 * Discriminates the two flows the column-config sidebar handles. Workflow
 * configuration is a separate component (`<WorkflowSidebar>`) so this surface
 * never has to branch on `isWorkflow`.
 */
export type ColumnConfig =
  | { mode: 'create'; proposedName: string; type: ColumnDefinition['type'] }
  | { mode: 'edit'; columnName: string }

interface ColumnConfigSidebarProps {
  /** When non-null the sidebar is open. */
  config: ColumnConfig | null
  onClose: () => void
  /** Existing column record for `mode: 'edit'`; ignored otherwise. */
  existingColumn: ColumnDefinition | null
  workspaceId: string
  tableId: string
  /** Notify parent of a rename so it can rewrite local `columnOrder` /
   *  `columnWidths` keys that reference the old name. */
  onColumnRename?: (oldName: string, newName: string) => void
}

/**
 * Right-edge sidebar for plain (non-workflow) column configuration. Handles
 * create (with type pre-chosen by the parent's "+ New column" dropdown) and
 * edit. No `isWorkflow` branches — workflow-output columns route through
 * `<WorkflowSidebar>` instead.
 *
 * Form state seeds from props via lazy `useState` initializers; the parent
 * uses `key={config?.columnName ?? 'closed'}` to remount when switching
 * columns, eliminating the prop-mirroring `useEffect` the previous combined
 * sidebar relied on.
 */
export function ColumnConfigSidebar(props: ColumnConfigSidebarProps) {
  // Mount the form body with `key` keyed on the config identity so opening a
  // different column / mode remounts and re-seeds state from props.
  const open = props.config !== null
  return (
    <aside
      role='dialog'
      aria-label='Configure column'
      className={cn(
        'absolute top-0 right-0 bottom-0 z-[var(--z-modal)] flex w-[400px] flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)] shadow-overlay transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {props.config && (
        <ColumnConfigBody key={configKey(props.config)} {...props} config={props.config} />
      )}
    </aside>
  )
}

function configKey(config: ColumnConfig): string {
  return config.mode === 'edit' ? `edit:${config.columnName}` : `create:${config.proposedName}`
}

interface ColumnConfigBodyProps extends Omit<ColumnConfigSidebarProps, 'config'> {
  config: ColumnConfig
}

function ColumnConfigBody({
  config,
  onClose,
  existingColumn,
  workspaceId,
  tableId,
  onColumnRename,
}: ColumnConfigBodyProps) {
  const updateColumn = useUpdateColumn({ workspaceId, tableId })
  const addColumn = useAddTableColumn({ workspaceId, tableId })

  const [nameInput, setNameInput] = useState<string>(() =>
    config.mode === 'edit' ? (existingColumn?.name ?? config.columnName) : config.proposedName
  )
  const [typeInput, setTypeInput] = useState<ColumnDefinition['type']>(() =>
    config.mode === 'edit' ? (existingColumn?.type ?? 'string') : config.type
  )
  const [uniqueInput, setUniqueInput] = useState<boolean>(() =>
    config.mode === 'edit' ? !!existingColumn?.unique : false
  )
  const [showValidation, setShowValidation] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const saveDisabled = updateColumn.isPending || addColumn.isPending
  const trimmedName = nameInput.trim()

  async function handleSave() {
    if (!trimmedName) {
      setShowValidation(true)
      return
    }

    try {
      if (config.mode === 'create') {
        await addColumn.mutateAsync({
          name: trimmedName,
          type: typeInput,
          ...(uniqueInput ? { unique: true } : {}),
        })
        toast.success(`Added "${trimmedName}"`)
        onClose()
        return
      }

      const renamed = trimmedName !== config.columnName
      const typeChanged = !!existingColumn && existingColumn.type !== typeInput
      const uniqueChanged = !!existingColumn && !!existingColumn.unique !== uniqueInput

      const updates: { name?: string; type?: ColumnDefinition['type']; unique?: boolean } = {
        ...(renamed ? { name: trimmedName } : {}),
        ...(typeChanged ? { type: typeInput } : {}),
        ...(uniqueChanged ? { unique: uniqueInput } : {}),
      }
      if (Object.keys(updates).length === 0) {
        onClose()
        return
      }

      await updateColumn.mutateAsync({ columnName: config.columnName, updates })
      if (renamed) onColumnRename?.(config.columnName, trimmedName)
      toast.success(`Saved "${trimmedName}"`)
      onClose()
    } catch (err) {
      if (isValidationError(err)) {
        const nameIssue =
          findValidationIssue(err, ['updates', 'name']) ??
          findValidationIssue(err, ['name']) ??
          findValidationIssue(err, ['columnName'])
        if (nameIssue) {
          setNameError(nameIssue.message)
          return
        }
        toast.error(toError(err).message)
      }
    }
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
        <h2 className='font-medium text-[var(--text-primary)] text-small'>Configure column</h2>
        <Button
          variant='ghost'
          size='sm'
          onClick={onClose}
          className='!p-1 size-7'
          aria-label='Close'
        >
          <X className='size-[14px]' />
        </Button>
      </div>

      <div className='flex-1 overflow-y-auto overflow-x-hidden px-2 pt-3 pb-2 [overflow-anchor:none]'>
        <div className='flex flex-col gap-[9.5px]'>
          <RequiredLabel htmlFor='column-sidebar-name'>Column name</RequiredLabel>
          <Input
            id='column-sidebar-name'
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value)
              if (nameError) setNameError(null)
            }}
            spellCheck={false}
            autoComplete='off'
            aria-invalid={(showValidation && !trimmedName) || nameError ? true : undefined}
          />
          {showValidation && !trimmedName && <FieldError message='Column name is required' />}
          {nameError && !(showValidation && !trimmedName) && <FieldError message={nameError} />}
        </div>

        {config.mode === 'edit' && (
          <>
            <FieldDivider />
            <div className='flex flex-col gap-[9.5px]'>
              <RequiredLabel>Type</RequiredLabel>
              <Combobox
                options={PLAIN_COLUMN_TYPE_OPTIONS.map((o) => ({
                  label: o.label,
                  value: o.type,
                  icon: o.icon,
                }))}
                value={typeInput}
                onChange={(v) => setTypeInput(v as ColumnDefinition['type'])}
                placeholder='Select type'
                maxHeight={260}
              />
            </div>
          </>
        )}

        <FieldDivider />
        <div className='flex flex-col gap-[9.5px]'>
          <div className='flex items-center justify-between pl-0.5'>
            <Label htmlFor='column-sidebar-unique'>Unique</Label>
            <Switch
              id='column-sidebar-unique'
              checked={uniqueInput}
              onCheckedChange={(v) => setUniqueInput(!!v)}
            />
          </div>
        </div>
      </div>

      <div className='flex items-center justify-end gap-2 border-[var(--border)] border-t px-2 py-3'>
        <Button variant='default' size='sm' onClick={onClose}>
          Cancel
        </Button>
        <Button variant='primary' size='sm' onClick={handleSave} disabled={saveDisabled}>
          {saveDisabled ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

function RequiredLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className='flex items-baseline gap-1.5 whitespace-nowrap pl-0.5'>
      {children}
      <span className='ml-0.5'>*</span>
    </Label>
  )
}

function FieldError({ message }: { message: string }) {
  return <p className='pl-0.5 text-caption text-destructive'>{message}</p>
}
