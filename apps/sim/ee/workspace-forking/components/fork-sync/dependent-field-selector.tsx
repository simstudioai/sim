'use client'

import { useMemo, useState } from 'react'
import { ChipCombobox, type ComboboxOption, Loader } from '@sim/emcn'
import type { SelectorKey } from '@/lib/selectors/manifest'
import type { SelectorContext } from '@/lib/selectors/types'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { dependentFieldNoun } from '@/ee/workspace-forking/components/fork-sync/dependent-field-noun'
import { useSelectorOptions } from '@/hooks/queries/selectors'
import { useDebounce } from '@/hooks/use-debounce'

interface DependentFieldSelectorProps {
  selectorKey: SelectorKey
  /** Full selector context, including the newly-chosen parent value. */
  context: Record<string, string>
  /** Workspace whose parent resource the selector browses. */
  workspaceId: string
  /** False until the parent (credential/KB) target is chosen. */
  enabled: boolean
  value: string
  onChange: (value: string) => void
  title: string
}

/**
 * A controlled, standalone selector for the sync page's pre-sync reconfigure: fetches
 * options via the shared selector data layer (the same `useSelectorOptions` registry the
 * canvas selectors use) without the canvas store/blockId coupling. Mirrors
 * {@link ConnectorSelectorField}.
 */
export function DependentFieldSelector({
  selectorKey,
  context,
  workspaceId,
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

  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebounce(searchTerm.trim(), SEARCH_DEBOUNCE_MS)

  const {
    data: options = [],
    isLoading,
    isFetchingMore,
    isLoadingAll,
    hasMore,
    truncated,
    loadMore,
    loadAll,
  } = useSelectorOptions(selectorKey, {
    context: selectorContext,
    scope: { kind: 'workspace', workspaceId },
    search: debouncedSearch,
    enabled,
    surfaceId: `fork:${title}`,
  })

  const comboboxOptions = useMemo<ComboboxOption[]>(
    () => options.map((option) => ({ label: option.label, value: option.id })),
    [options]
  )

  const noun = dependentFieldNoun(title)

  if (isLoading && enabled) {
    return (
      <div className='flex h-[30px] items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 text-[var(--text-muted)] text-small dark:bg-[var(--surface-4)]'>
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
      onSearchChange={setSearchTerm}
      searchPlaceholder={`Search ${noun}...`}
      placeholder={`Select ${noun}`}
      disabled={!enabled}
      hasMore={hasMore}
      isLoadingMore={isFetchingMore}
      isLoadingAll={isLoadingAll}
      truncated={truncated}
      onLoadMore={loadMore}
      onLoadAll={loadAll}
      emptyMessage={`No ${noun} found`}
    />
  )
}
