'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

  const { loadingKnowledgeBasesList } = useKnowledgeStore()

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialFetchDone, setInitialFetchDone] = useState(false)

  // Use the proper hook to get the current value and setter - this prevents infinite loops
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  const isMultiSelect = subBlock.multiSelect === true

  /**
   * Convert knowledge bases to combobox options format
   */
  const options = useMemo<ComboboxOption[]>(() => {
    return knowledgeBases.map((kb) => ({
      label: kb.name,
      value: kb.id,
      icon: PackageSearchIcon,
    }))
  }, [knowledgeBases])

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
  const selectedKnowledgeBases = useMemo(() => {
    if (selectedIds.length > 0 && knowledgeBases.length > 0) {
      return knowledgeBases.filter((kb) => selectedIds.includes(kb.id))
    }
    return []
  }, [selectedIds, knowledgeBases])

  /**
   * Fetch knowledge bases directly from API
   */
  const fetchKnowledgeBases = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const url = workspaceId ? `/api/knowledge?workspaceId=${workspaceId}` : '/api/knowledge'
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch knowledge bases: ${response.status} ${response.statusText}`
        )
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch knowledge bases')
      }

      const data = result.data || []
      setKnowledgeBases(data)
      setInitialFetchDone(true)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message)
      setKnowledgeBases([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

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
    if (!initialFetchDone && !loading && !isPreview) {
      fetchKnowledgeBases()
    }
  }, [initialFetchDone, loading, isPreview, fetchKnowledgeBases])

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
        isLoading={loading || loadingKnowledgeBasesList}
        error={error}
      />
    </div>
  )
}
