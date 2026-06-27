'use client'

import { useMemo } from 'react'
import { ChipCombobox, type ComboboxOption, Loader } from '@/components/emcn'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'
import { useSelectorOptions } from '@/hooks/selectors/use-selector-query'

interface DependentFieldSelectorProps {
  selectorKey: SelectorKey
  /** Full selector context, including the newly-chosen parent value. */
  context: Record<string, string>
  /** False until the parent (credential/KB) target is chosen. */
  enabled: boolean
  value: string
  onChange: (value: string) => void
  title: string
}

/**
 * A controlled, standalone selector for the sync modal's pre-sync reconfigure: fetches
 * options via the shared selector data layer (the same `useSelectorOptions` registry the
 * canvas selectors use) without the canvas store/blockId coupling. Mirrors
 * {@link ConnectorSelectorField}.
 */
export function DependentFieldSelector({
  selectorKey,
  context,
  enabled,
  value,
  onChange,
  title,
}: DependentFieldSelectorProps) {
  const selectorContext = useMemo<SelectorContext>(() => {
    const ctx: SelectorContext = {}
    Object.assign(ctx, context)
    return ctx
  }, [context])

  const { data: options = [], isLoading } = useSelectorOptions(selectorKey, {
    context: selectorContext,
    enabled,
  })

  const comboboxOptions = useMemo<ComboboxOption[]>(
    () => options.map((option) => ({ label: option.label, value: option.id })),
    [options]
  )

  if (isLoading && enabled) {
    return (
      <div className='flex h-[30px] items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 font-medium text-[var(--text-muted)] text-small dark:bg-[var(--surface-4)]'>
        <Loader className='size-3.5' animate />
        Loading…
      </div>
    )
  }

  return (
    <ChipCombobox
      className='w-full'
      options={comboboxOptions}
      value={value || undefined}
      onChange={(next) => onChange(next)}
      searchable
      searchPlaceholder={`Search ${title.toLowerCase()}...`}
      placeholder={`Select ${title.toLowerCase()}`}
      disabled={!enabled}
      emptyMessage={`No ${title.toLowerCase()} found`}
    />
  )
}
