'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { FieldFrame, SelectField, TextField } from '@sim/emcn/field'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { toError } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { columnTypeOptionsForTable } from '@/app/(product)/_components/workspace/tables/column-types/column-types'
import { SelectOptionsEditor } from '@/app/(product)/_components/workspace/tables/select-field/select-field'
import {
  SidePanel,
  SidePanelSection,
} from '@/app/(product)/_components/workspace/tables/side-panel/side-panel'
import {
  type ColumnDefinition,
  DEFAULT_CURRENCY_CODE,
  findValidationIssue,
  getCurrencyOptions,
  isValidationError,
  resolveCurrencyCode,
  type SelectOption,
  useAddTableColumn,
  useUpdateColumn,
} from '@/platform/lib/data/tables'

type ColumnType = ColumnDefinition['type']

/** Picker entries, built once: the list comes from the runtime's currency data and never varies. */
const CURRENCY_OPTIONS = getCurrencyOptions().map((currency) => ({
  value: currency.code,
  label: `${currency.code} · ${currency.name}`,
}))

function optionsEqual(a: SelectOption[], b: SelectOption[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The two flows the column panel handles: adding a column whose type the "New column" menu already
 * chose, and editing an existing one. Workflow columns are configured by their own panel.
 */
export type ColumnConfig =
  | { mode: 'create'; proposedName: string; type: ColumnType }
  | { mode: 'edit'; columnName: string }

interface ColumnConfigPanelProps {
  config: ColumnConfig
  onClose: () => void
  /** The column being edited in `edit` mode; ignored when creating. */
  existingColumn: ColumnDefinition | null
  allColumns: readonly ColumnDefinition[]
  workspaceId: string
  tableId: string
  /** Tells the page about a rename, so it can rewrite column order and width keys that used the old name. */
  onColumnRename?: (oldName: string, newName: string) => void
  /**
   * Opens the panel only to read: every field is inert and Save is unavailable behind
   * `readOnlyReason`. A header click opens this panel, so a schema-locked or read-only table still
   * shows the column's settings rather than swallowing the click.
   */
  readOnly?: boolean
  /** Why saving is unavailable, explained on the disabled Save action. */
  readOnlyReason?: string
}

/**
 * The right-hand panel that configures a plain (non-workflow) column: its name, type, currency,
 * select options and constraints. The page mounts it only while open and keys it on the config, so
 * each column or mode seeds a fresh form from its props.
 */
export function ColumnConfigPanel({
  config,
  onClose,
  existingColumn,
  allColumns,
  workspaceId,
  tableId,
  onColumnRename,
  readOnly,
  readOnlyReason,
}: ColumnConfigPanelProps) {
  const updateColumn = useUpdateColumn({ workspaceId, tableId })
  const addColumn = useAddTableColumn({ workspaceId, tableId })

  const [nameInput, setNameInput] = useState<string>(() =>
    config.mode === 'edit' ? (existingColumn?.name ?? config.columnName) : config.proposedName
  )
  const [typeInput, setTypeInput] = useState<ColumnType>(() =>
    config.mode === 'edit' ? (existingColumn?.type ?? 'string') : config.type
  )
  const [uniqueInput, setUniqueInput] = useState<boolean>(() =>
    config.mode === 'edit' ? Boolean(existingColumn?.unique) : false
  )
  const [optionsInput, setOptionsInput] = useState<SelectOption[]>(() =>
    config.mode === 'edit' ? (existingColumn?.options ?? []) : []
  )
  const [multipleInput, setMultipleInput] = useState<boolean>(() =>
    config.mode === 'edit' ? Boolean(existingColumn?.multiple) : false
  )
  const [currencyInput, setCurrencyInput] = useState<string>(() =>
    config.mode === 'edit'
      ? resolveCurrencyCode(existingColumn?.currencyCode)
      : DEFAULT_CURRENCY_CODE
  )
  const [showValidation, setShowValidation] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)

  const saving = updateColumn.isPending || addColumn.isPending
  const trimmedName = nameInput.trim()
  const wantsOptions = typeInput === 'select'
  const wantsCurrency = typeInput === 'currency'
  const trimmedOptions = optionsInput.map((option) => ({ ...option, name: option.name.trim() }))
  const missingName = showValidation && !trimmedName

  const typeOptions = columnTypeOptionsForTable(allColumns, existingColumn).flatMap((option) =>
    option.type === 'workflow'
      ? []
      : [
          {
            value: option.type,
            label: option.label,
            disabled: option.disabledReason !== undefined,
            disabledReason: option.disabledReason,
          },
        ]
  )

  /** The server's option rules, checked first so a mistake shows beside the options. */
  function validateOptions(): string | null {
    if (!wantsOptions) return null
    if (trimmedOptions.length === 0) return 'Add at least one option'
    if (trimmedOptions.some((option) => !option.name)) return 'Option names cannot be empty'
    const names = trimmedOptions.map((option) => option.name.toLowerCase())
    if (new Set(names).size !== names.length) return 'Option names must be unique'
    return null
  }

  async function handleSave() {
    // The action is unavailable when read-only, and the server refuses too.
    if (readOnly) return
    if (!trimmedName) {
      setShowValidation(true)
      return
    }

    const optionsIssue = validateOptions()
    if (optionsIssue) {
      setOptionsError(optionsIssue)
      return
    }

    try {
      if (config.mode === 'create') {
        await addColumn.mutateAsync({
          name: trimmedName,
          type: typeInput,
          // A select column has no unique constraint.
          ...(!wantsOptions && uniqueInput ? { unique: true } : {}),
          ...(wantsOptions ? { options: trimmedOptions } : {}),
          ...(wantsOptions && multipleInput ? { multiple: true } : {}),
          ...(wantsCurrency ? { currencyCode: currencyInput } : {}),
        })
        toast.success(`Added "${trimmedName}"`)
        onClose()
        return
      }

      // `config.columnName` is the column id; a rename compares against the current display name.
      const renamed = trimmedName !== (existingColumn?.name ?? config.columnName)
      const typeChanged = existingColumn !== null && existingColumn.type !== typeInput
      const uniqueChanged =
        !wantsOptions && existingColumn !== null && Boolean(existingColumn.unique) !== uniqueInput
      // Select columns offer no Unique control, so converting a unique column to select would
      // strand the constraint with no way to clear it.
      const uniqueCleared = wantsOptions && Boolean(existingColumn?.unique)
      const optionsChanged =
        wantsOptions && !optionsEqual(existingColumn?.options ?? [], trimmedOptions)
      const multipleChanged = wantsOptions && Boolean(existingColumn?.multiple) !== multipleInput
      const currencyChanged =
        wantsCurrency && resolveCurrencyCode(existingColumn?.currencyCode) !== currencyInput

      const updates: {
        name?: string
        type?: ColumnType
        unique?: boolean
        options?: SelectOption[]
        multiple?: boolean
        currencyCode?: string
      } = {
        ...(renamed ? { name: trimmedName } : {}),
        ...(typeChanged ? { type: typeInput } : {}),
        ...(uniqueChanged ? { unique: uniqueInput } : {}),
        ...(uniqueCleared ? { unique: false } : {}),
        ...(wantsOptions && (typeChanged || optionsChanged) ? { options: trimmedOptions } : {}),
        ...(wantsOptions && (typeChanged || multipleChanged) ? { multiple: multipleInput } : {}),
        ...(wantsCurrency && (typeChanged || currencyChanged)
          ? { currencyCode: currencyInput }
          : {}),
      }
      if (Object.keys(updates).length === 0) {
        onClose()
        return
      }

      await updateColumn.mutateAsync({ columnName: config.columnName, updates })
      if (renamed) onColumnRename?.(config.columnName, trimmedName)
      toast.success(`Saved "${trimmedName}"`)
      onClose()
    } catch (error) {
      // Any other failure was already announced by the mutation's own toast.
      if (isValidationError(error)) {
        const nameIssue =
          findValidationIssue(error, ['updates', 'name']) ??
          findValidationIssue(error, ['name']) ??
          findValidationIssue(error, ['columnName'])
        if (nameIssue) {
          setNameError(nameIssue.message)
          return
        }
        toast.error(toError(error).message)
      }
    }
  }

  return (
    <SidePanel
      title='Configure column'
      onClose={onClose}
      footer={
        <>
          <Button variant='quiet' size='compact' onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {readOnly ? (
            <Button variant='primary' size='compact' disabled disabledReason={readOnlyReason}>
              Save
            </Button>
          ) : (
            <Button
              variant='primary'
              size='compact'
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </>
      }
    >
      <SidePanelSection>
        <TextField
          label='Column name'
          placeholder='Enter a column name'
          autoComplete='off'
          value={nameInput}
          onChange={(value) => {
            setNameInput(value)
            if (nameError) setNameError(null)
          }}
          readOnly={readOnly}
          error={missingName ? 'Column name is required' : (nameError ?? undefined)}
        />
        {config.mode === 'edit' && (
          <SelectField<ColumnType>
            label='Type'
            options={typeOptions}
            value={typeInput}
            onValueChange={setTypeInput}
            disabled={readOnly}
          />
        )}
        {wantsCurrency && (
          <SearchableSelect
            label='Currency'
            options={CURRENCY_OPTIONS}
            value={currencyInput}
            onValueChange={(code) => {
              if (code) setCurrencyInput(code)
            }}
            placeholder='Select currency'
            searchLabel='Search currencies'
            disabled={readOnly}
          />
        )}
      </SidePanelSection>

      {wantsOptions ? (
        <SidePanelSection>
          <FieldFrame label='Options' error={optionsError ?? undefined}>
            <SelectOptionsEditor
              options={optionsInput}
              onChange={(next) => {
                setOptionsInput(next)
                if (optionsError) setOptionsError(null)
              }}
              readOnly={readOnly}
            />
          </FieldFrame>
          <Checkbox
            label='Multiselect'
            checked={multipleInput}
            onCheckedChange={setMultipleInput}
            disabled={readOnly}
          />
        </SidePanelSection>
      ) : (
        <SidePanelSection>
          <Checkbox
            label='Unique'
            checked={uniqueInput}
            onCheckedChange={setUniqueInput}
            disabled={readOnly}
          />
        </SidePanelSection>
      )}
    </SidePanel>
  )
}
