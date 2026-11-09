import { useEffect, useRef, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { SelectField } from '@sim/emcn/field'
import { Input } from '@sim/emcn/field/inputs'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { generateShortId } from '@sim/utils/id'
import styles from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/select-field/select-field.module.css'
import type { ColumnDefinition, SelectOption } from '@/platform/lib/data/tables'

/** Reads the raw stored option ids from a cell value (single string or array). */
function toSelectedIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string' && value !== '') return [value]
  return []
}

/**
 * Resolves a `select` cell's stored ids to their declared options, preserving selection order. An
 * id with no matching option, stale after that option was deleted, is dropped, so the cell falls
 * back to empty ("None") rather than showing an orphaned reference.
 */
export function resolveSelectOptions(column: ColumnDefinition, value: unknown): SelectOption[] {
  const byId = new Map((column.options ?? []).map((o) => [o.id, o]))
  return toSelectedIds(value)
    .map((id) => byId.get(id))
    .filter((o): o is SelectOption => o != null)
}

/** The still-valid option ids of a cell (orphaned or removed ids dropped). */
export function selectedOptionIds(column: ColumnDefinition, value: unknown): string[] {
  return resolveSelectOptions(column, value).map((o) => o.id)
}

interface SelectValueEditorProps {
  column: ColumnDefinition
  value: unknown
  /** A single column emits an option id or null; a multiselect emits an array of ids. */
  onChange: (next: string | string[] | null) => void
  /** Supporting text beneath the field, such as the column's type. */
  hint?: string
}

const CLEAR_VALUE = ''

/**
 * The option picker for a `select` column in a form, labeled with the column's name, that writes
 * option ids back through `onChange`. A single column offers "None" to clear its value unless it is
 * required, where an empty value could never be saved; a required multiselect ignores the change
 * that would remove its last option for the same reason. Inline grid editing uses its own menu.
 */
export function SelectValueEditor({ column, value, onChange, hint }: SelectValueEditorProps) {
  const options = (column.options ?? []).map((option) => ({
    value: option.id,
    label: option.name,
  }))
  const selected = selectedOptionIds(column, value)

  if (column.multiple) {
    return (
      <MultiSelect
        label={column.name}
        options={options}
        value={selected}
        onValueChange={(ids) => {
          if (column.required && ids.length === 0) return
          onChange(ids)
        }}
        placeholder='Select options'
        searchLabel='Search options'
        hint={hint}
      />
    )
  }

  return (
    <SelectField
      label={column.name}
      optional={!column.required}
      hint={hint}
      options={column.required ? options : [{ value: CLEAR_VALUE, label: 'None' }, ...options]}
      value={selected[0] ?? CLEAR_VALUE}
      onValueChange={(id) => onChange(id === CLEAR_VALUE ? null : id)}
    />
  )
}

interface SelectOptionsEditorProps {
  options: SelectOption[]
  onChange: (options: SelectOption[]) => void
  /** Shows the options without letting them change, for a panel opened only to read. */
  readOnly?: boolean
}

/**
 * Adds, renames and removes the options of a `select` column. Option ids stay stable across edits,
 * so existing cell data survives a rename. A new option is added by typing into the trailing empty
 * row: the first keystroke creates the option and moves focus into it, so typing flows straight
 * through, and Enter in any option returns to the trailing row to add the next one.
 */
export function SelectOptionsEditor({ options, onChange, readOnly }: SelectOptionsEditorProps) {
  const inputElementsRef = useRef<Map<string, HTMLInputElement> | null>(null)
  const inputElements = (inputElementsRef.current ??= new Map())
  const inputCallbacksRef = useRef<Map<string, (element: HTMLInputElement | null) => void> | null>(
    null
  )
  const inputCallbacks = (inputCallbacksRef.current ??= new Map())
  const trailingRef = useRef<HTMLInputElement>(null)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)

  // The new row and `pendingFocusId` land in the same commit, so its input is registered by now.
  useEffect(() => {
    if (!pendingFocusId) return
    const element = inputElements.get(pendingFocusId)
    if (element) {
      element.focus()
      const end = element.value.length
      element.setSelectionRange(end, end)
    }
    setPendingFocusId(null)
  }, [pendingFocusId])

  /** One stable ref callback per option, so a re-render never detaches and re-measures its input. */
  function registerInput(id: string) {
    let callback = inputCallbacks.get(id)
    if (!callback) {
      callback = (element: HTMLInputElement | null) => {
        if (element) inputElements.set(id, element)
        else inputElements.delete(id)
      }
      inputCallbacks.set(id, callback)
    }
    return callback
  }

  function update(id: string, patch: Partial<SelectOption>) {
    onChange(options.map((option) => (option.id === id ? { ...option, ...patch } : option)))
  }

  function remove(id: string) {
    inputElements.delete(id)
    inputCallbacks.delete(id)
    onChange(options.filter((option) => option.id !== id))
  }

  function materialize(name: string) {
    const id = generateShortId()
    onChange([...options, { id, name }])
    setPendingFocusId(id)
  }

  return (
    <div className={styles.options} data-read-only={readOnly || undefined}>
      {options.map((option, index) => (
        <div
          key={option.id}
          className={styles.option}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || readOnly) return
            event.preventDefault()
            trailingRef.current?.focus()
          }}
        >
          <Input
            label={`Option ${index + 1}`}
            inputRef={registerInput(option.id)}
            value={option.name}
            onChange={(name) => update(option.id, { name })}
            placeholder='Option name'
            spellCheck={false}
            autoComplete='off'
            readOnly={readOnly}
          />
          {!readOnly && (
            <IconButton
              label={`Remove ${option.name || 'option'}`}
              icon='I105'
              size='row'
              onClick={() => remove(option.id)}
            />
          )}
        </div>
      ))}
      {!readOnly && (
        <div className={styles.option}>
          <Input
            label='Add option'
            inputRef={trailingRef}
            value=''
            onChange={(name) => {
              if (name) materialize(name)
            }}
            placeholder='Add option'
            spellCheck={false}
            autoComplete='off'
          />
        </div>
      )}
    </div>
  )
}
