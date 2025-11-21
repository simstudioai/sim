'use client'

import { useCallback, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Combobox, type ComboboxOption } from '@/components/emcn/components/combobox/combobox'
import { PackageSearchIcon } from '@/components/icons'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { fetchKnowledgeBase, knowledgeKeys } from '@/hooks/queries/knowledge'
import { useKnowledgeBasesList } from '@/hooks/use-knowledge'
import type { KnowledgeBaseData } from '@/stores/knowledge/store'

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

  const {
    knowledgeBases,
    isLoading: isKnowledgeBasesLoading,
    error,
  } = useKnowledgeBasesList(workspaceId)

  // Use the proper hook to get the current value and setter - this prevents infinite loops
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  const isMultiSelect = subBlock.multiSelect === true

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
   * Convert knowledge bases to combobox options format
   */
  const selectedKnowledgeBaseQueries = useQueries({
    queries: selectedIds.map((selectedId) => ({
      queryKey: knowledgeKeys.detail(selectedId),
      queryFn: () => fetchKnowledgeBase(selectedId),
      enabled: Boolean(selectedId),
      staleTime: 60 * 1000,
    })),
  })

  const combinedKnowledgeBases = useMemo<KnowledgeBaseData[]>(() => {
    const merged = new Map<string, KnowledgeBaseData>()
    knowledgeBases.forEach((kb) => merged.set(kb.id, kb))

    selectedKnowledgeBaseQueries.forEach((query) => {
      if (query.data) {
        merged.set(query.data.id, query.data)
      }
    })

    return Array.from(merged.values())
  }, [knowledgeBases, selectedKnowledgeBaseQueries])

  const options = useMemo<ComboboxOption[]>(() => {
    return combinedKnowledgeBases.map((kb) => ({
      label: kb.name,
      value: kb.id,
      icon: PackageSearchIcon,
    }))
  }, [combinedKnowledgeBases])

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
        isLoading={isKnowledgeBasesLoading}
        error={error}
      />
    </div>
  )
}
