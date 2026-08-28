import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Combobox as EditableCombobox } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { getSelectorManifestEntry, type SelectorKey } from '@/lib/selectors/manifest'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sub-block-input-controller'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import type { SubBlockConfig } from '@/blocks/types'
import {
  type SelectorClientContext,
  useSelectorOptionDetail,
  useSelectorOptionDetails,
  useSelectorOptionMap,
  useSelectorOptions,
} from '@/hooks/queries/selectors'
import { useDebounce } from '@/hooks/use-debounce'

interface SelectorComboboxProps {
  blockId: string
  subBlock: SubBlockConfig
  selectorKey: SelectorKey
  selectorContext: SelectorClientContext
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | string[] | null
  placeholder?: string
  readOnly?: boolean
  onOptionChange?: (value: string) => void
  allowSearch?: boolean
  missingOptionLabel?: string
  /** When true, store an array of ids and render removable chips (e.g. channel filter). */
  multiSelect?: boolean
}

export function SelectorCombobox({
  blockId,
  subBlock,
  selectorKey,
  selectorContext,
  disabled,
  isPreview,
  previewValue,
  placeholder,
  readOnly,
  onOptionChange,
  allowSearch = true,
  missingOptionLabel,
  multiSelect = false,
}: SelectorComboboxProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const manifest = getSelectorManifestEntry(selectorKey)
  const [storeValueRaw, setStoreValue] = useSubBlockValue<string | string[] | null | undefined>(
    blockId,
    subBlock.id
  )
  const storeValue = typeof storeValueRaw === 'string' ? storeValueRaw : undefined
  const previewedValue = typeof previewValue === 'string' ? previewValue : undefined
  // Single-select active value; undefined in multi mode so detail/label hooks no-op.
  const activeValue: string | undefined = multiSelect
    ? undefined
    : isPreview
      ? previewedValue
      : storeValue
  const selectedValues = useMemo<string[]>(() => {
    if (!multiSelect) return []
    const source = isPreview ? previewValue : storeValueRaw
    if (Array.isArray(source)) return source.map(String)
    if (typeof source === 'string' && source.length > 0) {
      return source
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    }
    return []
  }, [multiSelect, isPreview, previewValue, storeValueRaw])
  const detailId = activeValue && !activeValue.startsWith('<') ? activeValue : undefined
  const multiDetailIds = useMemo(
    () => selectedValues.filter((id) => !id.startsWith('<')),
    [selectedValues]
  )
  const [searchTerm, setSearchTerm] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [multiInput, setMultiInput] = useState('')
  /**
   * The search reaches the provider, so it is debounced before it enters the query key
   * rather than on every keystroke — several of these selectors are rate-limited by the
   * provider. Only the query sees the debounced value; the input stays on `searchTerm`.
   *
   * Clearing is not debounced: a multi-select pick resets the term so the next choice comes
   * from the full list, and waiting out the delay would leave the previous filtered results
   * on screen. This mirrors the shared debounced-search setter, which also flushes empty.
   */
  const trimmedSearch = searchTerm.trim()
  const debouncedSearch = useDebounce(trimmedSearch, SEARCH_DEBOUNCE_MS)
  const activeSearch = trimmedSearch === '' ? '' : debouncedSearch
  const surfaceId = `${blockId}:${subBlock.id}`
  const listInteractionEnabled = !disabled && !isPreview && !readOnly
  const listHydrationEnabled =
    !listInteractionEnabled &&
    !manifest.supportsDetail &&
    Boolean(detailId || multiDetailIds.length > 0)
  const {
    data: options = [],
    isLoading,
    hasMore,
    error,
  } = useSelectorOptions(selectorKey, {
    context: selectorContext,
    search: listInteractionEnabled && allowSearch ? activeSearch : undefined,
    enabled: listInteractionEnabled || listHydrationEnabled,
    surfaceId,
  })
  const { data: detailOption, isLoading: isLoadingDetail } = useSelectorOptionDetail(selectorKey, {
    context: selectorContext,
    detailId,
    enabled: manifest.supportsDetail && Boolean(detailId),
    surfaceId,
  })
  const detailOptions = useSelectorOptionDetails(selectorKey, {
    context: selectorContext,
    detailIds: multiDetailIds,
    enabled: manifest.supportsDetail && multiSelect && multiDetailIds.length > 0,
    surfaceId,
  })
  const optionsWithDetails = useMemo(() => {
    const merged = new Map(options.map((option) => [option.id, option]))
    for (const option of detailOptions) {
      if (!merged.has(option.id)) merged.set(option.id, option)
    }
    return [...merged.values()]
  }, [detailOptions, options])
  const optionMap = useSelectorOptionMap(optionsWithDetails, detailOption ?? undefined)
  const hasMissingOption =
    Boolean(activeValue) &&
    Boolean(missingOptionLabel) &&
    !isLoading &&
    !isLoadingDetail &&
    !hasMore &&
    !optionMap.get(activeValue!)
  const selectedLabel: string = activeValue
    ? hasMissingOption
      ? (missingOptionLabel ?? activeValue)
      : (optionMap.get(activeValue)?.label ?? activeValue)
    : ''
  const [inputValue, setInputValue] = useState(selectedLabel)
  const previousActiveValue = useRef<string | undefined>(activeValue)

  useEffect(() => {
    if (previousActiveValue.current !== activeValue) {
      previousActiveValue.current = activeValue
      setIsEditing(false)
    }
  }, [activeValue])

  useEffect(() => {
    if (!allowSearch) return
    if (!isEditing) {
      setInputValue(selectedLabel)
    }
  }, [selectedLabel, allowSearch, isEditing])

  const comboboxOptions = useMemo(
    () =>
      Array.from(optionMap.values()).map((option) => ({
        label: option.label,
        value: option.id,
      })),
    [optionMap]
  )

  const handleSelection = useCallback(
    (value: string) => {
      if (readOnly || disabled) return
      setStoreValue(value)
      setIsEditing(false)
      onOptionChange?.(value)
    },
    [setStoreValue, onOptionChange, readOnly, disabled]
  )

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (readOnly || disabled) return
      setStoreValue(null)
      setInputValue('')
      onOptionChange?.('')
    },
    [setStoreValue, onOptionChange, readOnly, disabled]
  )

  const handleMultiChange = useCallback(
    (values: string[]) => {
      if (readOnly || disabled) return
      setStoreValue(values)
      // Reset the search box so the next channel is picked from the full list.
      setMultiInput('')
      setSearchTerm('')
    },
    [setStoreValue, readOnly, disabled]
  )

  const showClearButton = Boolean(activeValue) && !disabled && !readOnly
  const displayValue = allowSearch ? inputValue : selectedLabel
  const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
    activeSearchTarget,
    blockId,
    subBlockId: subBlock.id,
    valuePath: [],
    label: displayValue,
  })

  if (multiSelect) {
    return (
      <div className='w-full'>
        <EditableCombobox
          options={comboboxOptions}
          value={multiInput}
          multiSelect
          multiSelectValues={selectedValues}
          onMultiSelectChange={handleMultiChange}
          onChange={(newValue) => {
            setMultiInput(newValue)
            if (allowSearch) setSearchTerm(newValue)
          }}
          placeholder={placeholder || subBlock.placeholder || 'Select channels'}
          disabled={disabled || readOnly}
          editable={allowSearch}
          filterOptions={allowSearch}
          isLoading={isLoading}
          error={error instanceof Error ? error.message : null}
        />
        {selectedValues.length > 0 && (
          <div className='mt-2 space-y-2'>
            {selectedValues.map((id) => (
              <div
                key={id}
                className='flex items-center justify-between gap-2 rounded-sm border border-[var(--border-1)] bg-[var(--surface-4)] px-2.5 py-[5px]'
              >
                <span className='block min-w-0 flex-1 truncate text-[var(--text-tertiary)] text-sm'>
                  {optionMap.get(id)?.label ?? id}
                </span>
                <Button
                  type='button'
                  variant='ghost'
                  className='h-auto shrink-0 p-0'
                  disabled={disabled || readOnly}
                  aria-label={`Remove ${optionMap.get(id)?.label ?? id}`}
                  onClick={() => handleMultiChange(selectedValues.filter((v) => v !== id))}
                >
                  <X className='size-[14px] text-[var(--text-icon)]' />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className='w-full'>
      <SubBlockInputController
        blockId={blockId}
        subBlockId={subBlock.id}
        config={subBlock}
        value={activeValue ?? ''}
        disabled={disabled || readOnly}
        isPreview={isPreview}
      >
        {({ ref, onDrop, onDragOver }) => (
          <div className='relative w-full'>
            <EditableCombobox
              options={comboboxOptions}
              value={displayValue}
              selectedValue={activeValue ?? ''}
              onChange={(newValue) => {
                const matched = optionMap.get(newValue)
                if (matched) {
                  setInputValue(matched.label)
                  setIsEditing(false)
                  handleSelection(matched.id)
                  return
                }
                if (allowSearch) {
                  setInputValue(newValue)
                  setIsEditing(true)
                  setSearchTerm(newValue)
                }
              }}
              placeholder={placeholder || subBlock.placeholder || 'Select an option'}
              disabled={disabled || readOnly}
              editable={allowSearch}
              filterOptions={allowSearch}
              inputRef={ref as React.RefObject<HTMLInputElement>}
              inputProps={{
                onDrop: onDrop as (e: React.DragEvent<HTMLInputElement>) => void,
                onDragOver: onDragOver as (e: React.DragEvent<HTMLInputElement>) => void,
                className: showClearButton ? 'pr-[60px]' : undefined,
              }}
              isLoading={isLoading}
              error={error instanceof Error ? error.message : null}
              overlayContent={
                workflowSearchHighlight ? (
                  <span className='block truncate'>
                    {formatDisplayText(displayValue, { workflowSearchHighlight })}
                  </span>
                ) : undefined
              }
            />
            {showClearButton && (
              <Button
                type='button'
                variant='ghost'
                className='-translate-y-1/2 absolute top-1/2 right-[28px] z-10 size-6 p-0'
                onClick={handleClear}
              >
                <X className='size-4 opacity-50 hover-hover:opacity-100' />
              </Button>
            )}
          </div>
        )}
      </SubBlockInputController>
    </div>
  )
}
