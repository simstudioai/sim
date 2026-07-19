'use client'

import { useMemo } from 'react'
import { ChipCombobox, type ComboboxOption } from '@sim/emcn'
import { InspectorField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/inspector-field'

/** The minimal shape a pickable workspace resource exposes. */
export interface ResourcePickerItem {
  id: string
  name: string
}

export interface ResourcePickerFieldProps {
  /** Field title; doubles as the combobox `aria-label`. */
  title: string
  /** Error shown when `value` no longer resolves against `items`. */
  missingMessage: string
  placeholder: string
  searchPlaceholder: string
  emptyMessage: string
  /** Pickable resources — `undefined` while the list query resolves. */
  items: readonly ResourcePickerItem[] | undefined
  isLoading: boolean
  /** The bound resource id, `null` when unbound. */
  value: string | null
  /** Receives the picked id, or `null` when the `None` entry clears the binding. */
  onChange: (next: string | null) => void
  disabled?: boolean
}

/**
 * Inspector field binding a module to one workspace resource — the single
 * source of the picker behavior every module section shares (file, table, and
 * the chat/form workflow bindings).
 *
 * The picker gains a leading `None` entry once a resource is bound so the
 * binding can be cleared, and surfaces `missingMessage` when the bound id no
 * longer resolves — layout validation only guards writes, so a resource
 * deleted after wiring stays in the config until the user repoints it.
 * Options keep the list query's order, so every picker in the inspector
 * presents the same resources in the same order.
 */
export function ResourcePickerField({
  title,
  missingMessage,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  items,
  isLoading,
  value,
  onChange,
  disabled = false,
}: ResourcePickerFieldProps) {
  const options = useMemo<ComboboxOption[]>(() => {
    const list = (items ?? []).map((item) => ({ label: item.name, value: item.id }))
    if (!value) return list
    return [{ label: 'None', value: '' }, ...list]
  }, [items, value])

  const missing = value !== null && items !== undefined && !items.some((item) => item.id === value)

  return (
    <InspectorField title={title} error={missing ? missingMessage : undefined}>
      <ChipCombobox
        options={options}
        value={value ?? ''}
        onChange={(next) => onChange(next === '' ? null : next)}
        placeholder={placeholder}
        searchable
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
        isLoading={isLoading}
        disabled={disabled}
        maxHeight={260}
        aria-label={title}
      />
    </InspectorField>
  )
}
