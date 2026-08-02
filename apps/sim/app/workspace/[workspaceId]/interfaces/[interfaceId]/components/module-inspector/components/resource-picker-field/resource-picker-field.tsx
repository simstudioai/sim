'use client'

import { useMemo } from 'react'
import { ChipCombobox, type ComboboxOption } from '@sim/emcn'
import {
  MODULE_RESOURCE_COPY,
  type ModuleResourceKind,
} from '@/components/resources/interface-view/module-resource-copy'
import { InspectorField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/inspector-field'

/** The minimal shape a pickable workspace resource exposes. */
export interface ResourcePickerItem {
  id: string
  name: string
}

export interface ResourcePickerFieldProps {
  /** Which workspace resource is being bound; selects the field's copy. */
  kind: ModuleResourceKind
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
 * binding can be cleared, and surfaces the kind's missing-resource message
 * when the bound id no longer resolves — layout validation only guards writes,
 * so a resource deleted after wiring stays in the config until the user
 * repoints it. Options keep the list query's order, so every picker in the
 * inspector presents the same resources in the same order.
 *
 * Copy comes from `MODULE_RESOURCE_COPY`, shared with the in-canvas picker so
 * the inspector and the canvas never spell the same binding differently.
 */
export function ResourcePickerField({
  kind,
  items,
  isLoading,
  value,
  onChange,
  disabled = false,
}: ResourcePickerFieldProps) {
  const copy = MODULE_RESOURCE_COPY[kind]
  const options = useMemo<ComboboxOption[]>(() => {
    const list = (items ?? []).map((item) => ({ label: item.name, value: item.id }))
    if (!value) return list
    return [{ label: 'None', value: '' }, ...list]
  }, [items, value])

  const missing = value !== null && items !== undefined && !items.some((item) => item.id === value)

  return (
    <InspectorField title={copy.title} error={missing ? copy.missingMessage : undefined}>
      <ChipCombobox
        options={options}
        value={value ?? ''}
        onChange={(next) => onChange(next === '' ? null : next)}
        placeholder={copy.placeholder}
        searchable
        searchPlaceholder={copy.searchPlaceholder}
        emptyMessage={copy.emptyMessage}
        isLoading={isLoading}
        disabled={disabled}
        maxHeight={260}
        aria-label={copy.title}
      />
    </InspectorField>
  )
}
