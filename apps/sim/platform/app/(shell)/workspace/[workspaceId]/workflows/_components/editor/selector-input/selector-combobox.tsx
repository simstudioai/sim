'use client'

import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { isWorkflowSearchTargetForField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import {
  ItemCard,
  ItemList,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/item-card/item-card'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/selector-input/selector-input.module.css'
import { selectorPickerSearch } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/selector-input/selector-list-footer'
import { ShortInput } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/short-input/short-input'
import { type SubBlockConfig, useSubBlockValue } from '@/platform/lib/data/workflow-editor'
import {
  getSelectorManifestEntry,
  type SelectorClientContext,
  type SelectorKey,
  useSelectorOptionDetail,
  useSelectorOptionDetails,
  useSelectorOptionMap,
  useSelectorOptions,
  useSelectorSearch,
} from '@/platform/lib/data/workflow-editor/selectors'

/** A run-time reference resolves later, so it is never looked up or matched against the list. */
function isReference(value: string): boolean {
  return value.startsWith('<') || value.includes('{{')
}

/** Whether a drop carries a block connection from the canvas, the start of a reference. */
function isConnectionDrop(event: DragEvent<HTMLElement>): boolean {
  try {
    const data: unknown = JSON.parse(event.dataTransfer.getData('application/json') || 'null')
    return (
      typeof data === 'object' && data !== null && 'type' in data && data.type === 'connectionBlock'
    )
  } catch {
    return false
  }
}

function readMultiValue(source: unknown): string[] {
  if (Array.isArray(source)) return source.map(String)
  if (typeof source === 'string' && source.length > 0)
    return source
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  return []
}

interface SelectorComboboxProps {
  blockId: string
  subBlock: SubBlockConfig
  selectorKey: SelectorKey
  selectorContext: SelectorClientContext
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
  placeholder?: string
  /** Whether the viewer's search reaches the provider. */
  allowSearch?: boolean
  /** Shown for a stored id the full list no longer carries, such as a deleted workflow. */
  missingOptionLabel?: string
  /** Store an array of ids, listed beneath the picker with their own remove actions. */
  multiSelect?: boolean
}

/**
 * A provider-backed picker for one resource or several: files, sheets, channels, users, projects,
 * columns, documents, folders, workflows. The search reaches the provider, the list pages as it
 * scrolls, and a selection the list does not carry still resolves through the provider's detail
 * lookup. Dropping a connection on the field, or a stored `<block.output>` reference, switches it to
 * a text field with the reference picker.
 */
export function SelectorCombobox({
  blockId,
  subBlock,
  selectorKey,
  selectorContext,
  disabled = false,
  isPreview = false,
  previewValue,
  placeholder,
  allowSearch = true,
  missingOptionLabel,
  multiSelect = false,
}: SelectorComboboxProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const manifest = getSelectorManifestEntry(selectorKey)
  const [storeValueRaw, setStoreValue] = useSubBlockValue<string | string[] | null>(
    blockId,
    subBlock.id
  )
  const source: unknown = isPreview ? previewValue : storeValueRaw
  const activeValue = !multiSelect && typeof source === 'string' ? source : undefined
  const selectedValues = useMemo(
    () => (multiSelect ? readMultiValue(source) : []),
    [multiSelect, source]
  )
  const detailId = activeValue && !isReference(activeValue) ? activeValue : undefined
  const multiDetailIds = useMemo(
    () => selectedValues.filter((id) => !isReference(id)),
    [selectedValues]
  )

  const search = useSelectorSearch()
  const surfaceId = `${blockId}:${subBlock.id}`
  const interactive = !disabled && !isPreview
  const hydrateFromList =
    !interactive && !manifest.supportsDetail && Boolean(detailId || multiDetailIds.length > 0)
  const list = useSelectorOptions(selectorKey, {
    context: selectorContext,
    search: interactive && allowSearch ? search.activeSearch : undefined,
    enabled: interactive || hydrateFromList,
    surfaceId,
  })
  const detail = useSelectorOptionDetail(selectorKey, {
    context: selectorContext,
    detailId,
    enabled: manifest.supportsDetail && Boolean(detailId),
    surfaceId,
  })
  const details = useSelectorOptionDetails(selectorKey, {
    context: selectorContext,
    detailIds: multiDetailIds,
    enabled: manifest.supportsDetail && multiSelect && multiDetailIds.length > 0,
    surfaceId,
  })

  const listOptions = list.data
  const optionsWithDetails = useMemo(() => {
    const merged = new Map((listOptions ?? []).map((option) => [option.id, option]))
    for (const option of details.data) if (!merged.has(option.id)) merged.set(option.id, option)
    return [...merged.values()]
  }, [details.data, listOptions])
  const optionMap = useSelectorOptionMap(optionsWithDetails, detail.data ?? undefined)

  const missing =
    Boolean(activeValue) &&
    Boolean(missingOptionLabel) &&
    !list.isLoading &&
    !detail.isLoading &&
    !list.hasMore &&
    !optionMap.get(activeValue ?? '')
  const selectedLabel = activeValue
    ? missing
      ? (missingOptionLabel ?? activeValue)
      : (optionMap.get(activeValue)?.label ?? activeValue)
    : undefined

  const query = search.query.trim().toLowerCase()
  const pickerOptions = useMemo(() => {
    const all = [...optionMap.values()].map((option) => ({
      value: option.id,
      label: option.label,
    }))
    if (manifest.supportsSearch && allowSearch) return all
    return query
      ? all.filter(
          (option) =>
            option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query)
        )
      : all
  }, [optionMap, manifest.supportsSearch, allowSearch, query])
  const selectedLabels = useMemo(
    () => Object.fromEntries(selectedValues.map((id) => [id, optionMap.get(id)?.label ?? id])),
    [selectedValues, optionMap]
  )

  const pickerSearch = selectorPickerSearch(
    search,
    {
      isLoading: list.isLoading || details.isLoading,
      isFetchingMore: list.isFetchingMore,
      isLoadingAll: list.isLoadingAll,
      hasMore: list.hasMore,
      truncated: list.truncated,
      error: list.error instanceof Error ? list.error.message : null,
      loadMore: list.loadMore,
      loadAll: () => void list.loadAll(),
    },
    pickerOptions.length > 0
  )

  const searchMatch = isWorkflowSearchTargetForField({
    activeSearchTarget,
    blockId,
    subBlockId: subBlock.id,
  })
  const label = subBlock.title || placeholder || subBlock.id

  const [referenceMode, setReferenceMode] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const showReference =
    !multiSelect && (referenceMode || Boolean(activeValue && isReference(activeValue)))

  useEffect(() => {
    if (referenceMode) fieldRef.current?.querySelector('input')?.focus()
  }, [referenceMode])

  const acceptsDrop = interactive && !multiSelect && subBlock.connectionDroppable !== false
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (acceptsDrop) event.preventDefault()
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop || !isConnectionDrop(event)) return
    event.preventDefault()
    setStoreValue('')
    setReferenceMode(true)
  }

  if (showReference)
    return (
      <div ref={fieldRef} className={styles.field} data-search-match={searchMatch || undefined}>
        <ShortInput
          blockId={blockId}
          subBlockId={subBlock.id}
          config={subBlock}
          placeholder={placeholder}
          value={activeValue ?? ''}
          onChange={(next) => {
            if (!interactive) return
            setReferenceMode(true)
            setStoreValue(next)
          }}
          onBlur={() => {
            if (!activeValue) setReferenceMode(false)
          }}
          isPreview={isPreview}
          previewValue={activeValue ?? null}
          disabled={disabled}
        />
      </div>
    )

  if (multiSelect)
    return (
      <div className={styles.field} data-search-match={searchMatch || undefined}>
        <MultiSelect
          label={label}
          labelHidden
          options={pickerOptions}
          value={selectedValues}
          selectedLabels={selectedLabels}
          onValueChange={(values) => {
            if (!interactive) return
            setStoreValue(values)
            search.reset()
          }}
          placeholder={placeholder || subBlock.placeholder || 'Select channels'}
          searchLabel={`Search ${label.toLowerCase()}`}
          search={pickerSearch}
          disabled={!interactive}
        />
        {selectedValues.length > 0 && (
          <ItemList label={`Selected ${label.toLowerCase()}`}>
            {selectedValues.map((id) => (
              <li key={id}>
                <ItemCard
                  name={selectedLabels[id]}
                  title={selectedLabels[id] ?? id}
                  expandable={false}
                  expanded={false}
                  actions={
                    interactive && (
                      <IconButton
                        label={`Remove ${selectedLabels[id]}`}
                        icon='I105'
                        size='compact'
                        onClick={() =>
                          setStoreValue(selectedValues.filter((value) => value !== id))
                        }
                      />
                    )
                  }
                />
              </li>
            ))}
          </ItemList>
        )}
      </div>
    )

  return (
    <div
      role='presentation'
      className={styles.pickerRow}
      data-search-match={searchMatch || undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className={styles.picker}>
        <SearchableSelect
          label={label}
          labelHidden
          options={pickerOptions}
          value={activeValue || null}
          selectedLabel={selectedLabel}
          onValueChange={(next) => {
            if (!interactive || next === null) return
            setStoreValue(next)
            search.reset()
          }}
          placeholder={placeholder || subBlock.placeholder || 'Select an option'}
          searchLabel={`Search ${label.toLowerCase()}`}
          search={pickerSearch}
          disabled={!interactive}
        />
      </span>
      {activeValue && interactive && (
        <IconButton
          label='Clear selection'
          icon='I105'
          size='row'
          onClick={() => setStoreValue(null)}
        />
      )}
    </div>
  )
}
