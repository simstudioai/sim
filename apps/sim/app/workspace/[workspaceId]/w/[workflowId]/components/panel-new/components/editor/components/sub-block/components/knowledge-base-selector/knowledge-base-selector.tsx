'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Combobox, type ComboboxOption } from '@/components/emcn/components/combobox/combobox'
import { PackageSearchIcon } from '@/components/icons'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { type KnowledgeBaseData, useKnowledgeStore } from '@/stores/knowledge/store'

interface KnowledgeBaseSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onKnowledgeBaseSelect?: (knowledgeBaseId: string | string[]) => void
  isPreview?: boolean
  previewValue?: string | null
}

export function KnowledgeBaseSelector({
  blockId,
  subBlock,
  disabled = false,
  onKnowledgeBaseSelect,
  isPreview = false,
  previewValue,
}: KnowledgeBaseSelectorProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const knowledgeBasesList = useKnowledgeStore((state) => state.knowledgeBasesList)
  const knowledgeBasesMap = useKnowledgeStore((state) => state.knowledgeBases)
  const loadingKnowledgeBasesList = useKnowledgeStore((state) => state.loadingKnowledgeBasesList)
  const getKnowledgeBasesList = useKnowledgeStore((state) => state.getKnowledgeBasesList)
  const getKnowledgeBase = useKnowledgeStore((state) => state.getKnowledgeBase)

  const [error, setError] = useState<string | null>(null)
  const hasRequestedListRef = useRef(false)

  // Use the proper hook to get the current value and setter - this prevents infinite loops
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  const isMultiSelect = subBlock.multiSelect === true

  /**
   * Convert knowledge bases to combobox options format
   */
  const combinedKnowledgeBases = useMemo<KnowledgeBaseData[]>(() => {
    const merged = new Map<string, KnowledgeBaseData>()
    knowledgeBasesList.forEach((kb) => {
      merged.set(kb.id, kb)
    })
    Object.values(knowledgeBasesMap).forEach((kb) => {
      merged.set(kb.id, kb)
    })
    return Array.from(merged.values())
  }, [knowledgeBasesList, knowledgeBasesMap])

  const options = useMemo<ComboboxOption[]>(() => {
    return combinedKnowledgeBases.map((kb) => ({
      label: kb.name,
      value: kb.id,
      icon: PackageSearchIcon,
    }))
  }, [combinedKnowledgeBases])

  /**
   * Parse value into array of selected IDs
   */
  const selectedIds = useMemo(() => {
    if (!value) return []
    if (typeof value === 'string') {
      return value.includes(',')
        ? value
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        : [value]
    }
    return []
  }, [value])

  /**
   * Compute selected knowledge bases for tag display
   */
  const selectedKnowledgeBases = useMemo<KnowledgeBaseData[]>(() => {
    if (selectedIds.length === 0) return []

    const lookup = new Map<string, KnowledgeBaseData>()
    combinedKnowledgeBases.forEach((kb) => {
      lookup.set(kb.id, kb)
    })

    return selectedIds
      .map((id) => lookup.get(id))
      .filter((kb): kb is KnowledgeBaseData => Boolean(kb))
  }, [selectedIds, combinedKnowledgeBases])

  /**
   * Handle single selection
   */
  const handleChange = useCallback(
    (selectedValue: string) => {
      if (isPreview) return

      setStoreValue(selectedValue)
      onKnowledgeBaseSelect?.(selectedValue)
    },
    [isPreview, setStoreValue, onKnowledgeBaseSelect]
  )

  /**
   * Handle multi-select changes
   */
  const handleMultiSelectChange = useCallback(
    (values: string[]) => {
      if (isPreview) return

      const valueToStore = values.length === 1 ? values[0] : values.join(',')
      setStoreValue(valueToStore)
      onKnowledgeBaseSelect?.(values)
    },
    [isPreview, setStoreValue, onKnowledgeBaseSelect]
  )

  /**
   * Remove selected knowledge base from multi-select tags
   */
  const handleRemoveKnowledgeBase = useCallback(
    (knowledgeBaseId: string) => {
      if (isPreview) return

      const newSelectedIds = selectedIds.filter((id) => id !== knowledgeBaseId)
      const valueToStore =
        newSelectedIds.length === 1 ? newSelectedIds[0] : newSelectedIds.join(',')

      setStoreValue(valueToStore)
      onKnowledgeBaseSelect?.(newSelectedIds)
    },
    [isPreview, selectedIds, setStoreValue, onKnowledgeBaseSelect]
  )

  /**
   * Fetch knowledge bases on initial mount
   */
  useEffect(() => {
    if (hasRequestedListRef.current) return

    let cancelled = false
    hasRequestedListRef.current = true
    setError(null)
    getKnowledgeBasesList(workspaceId).catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Failed to load knowledge bases')
    })

    return () => {
      cancelled = true
    }
  }, [workspaceId, getKnowledgeBasesList])

  /**
   * Ensure selected knowledge bases are cached
   */
  useEffect(() => {
    if (selectedIds.length === 0) return

    selectedIds.forEach((id) => {
      const isKnown =
        Boolean(knowledgeBasesMap[id]) ||
        knowledgeBasesList.some((knowledgeBase) => knowledgeBase.id === id)

      if (!isKnown) {
        void getKnowledgeBase(id).catch(() => {
          // Ignore fetch errors here; they will surface via display hooks if needed
        })
      }
    })
  }, [selectedIds, knowledgeBasesList, knowledgeBasesMap, getKnowledgeBase])

  const label =
    subBlock.placeholder || (isMultiSelect ? 'Select knowledge bases' : 'Select knowledge base')

  return (
    <div className='w-full'>
      {/* Selected knowledge bases display (for multi-select) */}
      {isMultiSelect && selectedKnowledgeBases.length > 0 && (
        <div className='mb-2 flex flex-wrap gap-1'>
          {selectedKnowledgeBases.map((kb) => (
            <div
              key={kb.id}
              className='inline-flex items-center rounded-md border border-[#00B0B0]/20 bg-[#00B0B0]/10 px-2 py-1 text-xs'
            >
              <PackageSearchIcon className='mr-1 h-3 w-3 text-[#00B0B0]' />
              <span className='font-medium text-[#00B0B0]'>{kb.name}</span>
              {!disabled && !isPreview && (
                <button
                  type='button'
                  onClick={() => handleRemoveKnowledgeBase(kb.id)}
                  className='ml-1 text-[#00B0B0]/60 hover:text-[#00B0B0]'
                  aria-label={`Remove ${kb.name}`}
                >
                  <X className='h-3 w-3' />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Combobox
        options={options}
        value={isMultiSelect ? undefined : (selectedIds[0] ?? '')}
        multiSelect={isMultiSelect}
        multiSelectValues={isMultiSelect ? selectedIds : undefined}
        onChange={handleChange}
        onMultiSelectChange={handleMultiSelectChange}
        placeholder={label}
        disabled={disabled || isPreview}
        isLoading={loadingKnowledgeBasesList}
        error={error}
      />
    </div>
  )
}
