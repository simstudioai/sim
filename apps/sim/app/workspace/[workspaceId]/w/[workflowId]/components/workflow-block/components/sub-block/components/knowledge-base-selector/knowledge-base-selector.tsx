'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, RefreshCw, X } from 'lucide-react'
import { PackageSearchIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { SubBlockConfig } from '@/blocks/types'
import { type KnowledgeBaseData, useKnowledgeStore } from '@/stores/knowledge/store'
import { useSubBlockValue } from '../../../sub-block/hooks/use-sub-block-value'

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
  const { getKnowledgeBasesList, knowledgeBasesList, loadingKnowledgeBasesList } =
    useKnowledgeStore()

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [initialFetchDone, setInitialFetchDone] = useState(false)

  // Use the proper hook to get the current value and setter - this prevents infinite loops
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  const isMultiSelect = subBlock.multiSelect === true

  // Compute selected knowledge bases directly from value - no local state to avoid loops
  const selectedKnowledgeBases = useMemo(() => {
    if (value && knowledgeBases.length > 0) {
      const selectedIds =
        typeof value === 'string'
          ? value.includes(',')
            ? value
                .split(',')
                .map((id) => id.trim())
                .filter((id) => id.length > 0)
            : [value]
          : []

      return knowledgeBases.filter((kb) => selectedIds.includes(kb.id))
    }
    return []
  }, [value, knowledgeBases])

  // Fetch knowledge bases
  const fetchKnowledgeBases = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await getKnowledgeBasesList()
      setKnowledgeBases(data)
      setInitialFetchDone(true)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message)
      setKnowledgeBases([])
    } finally {
      setLoading(false)
    }
  }, [getKnowledgeBasesList])

  // Handle dropdown open/close - fetch knowledge bases when opening
  const handleOpenChange = (isOpen: boolean) => {
    if (isPreview) return

    setOpen(isOpen)

    // Only fetch knowledge bases when opening the dropdown if we haven't fetched yet
    if (isOpen && (!initialFetchDone || knowledgeBasesList.length === 0)) {
      fetchKnowledgeBases()
    }
  }

  // Handle single knowledge base selection (for backward compatibility)
  const handleSelectSingleKnowledgeBase = (knowledgeBase: KnowledgeBaseData) => {
    if (isPreview) return

    // Use the hook's setter which handles collaborative updates
    setStoreValue(knowledgeBase.id)

    onKnowledgeBaseSelect?.(knowledgeBase.id)
    setOpen(false)
  }

  // Handle multi-select knowledge base selection
  const handleToggleKnowledgeBase = (knowledgeBase: KnowledgeBaseData) => {
    if (isPreview) return

    const isCurrentlySelected = selectedKnowledgeBases.some((kb) => kb.id === knowledgeBase.id)
    let newSelected: KnowledgeBaseData[]

    if (isCurrentlySelected) {
      // Remove from selection
      newSelected = selectedKnowledgeBases.filter((kb) => kb.id !== knowledgeBase.id)
    } else {
      // Add to selection
      newSelected = [...selectedKnowledgeBases, knowledgeBase]
    }

    const selectedIds = newSelected.map((kb) => kb.id)
    const valueToStore = selectedIds.length === 1 ? selectedIds[0] : selectedIds.join(',')

    // Use the hook's setter which handles collaborative updates
    setStoreValue(valueToStore)

    onKnowledgeBaseSelect?.(selectedIds)
  }

  // Remove selected knowledge base (for multi-select tags)
  const handleRemoveKnowledgeBase = (knowledgeBaseId: string) => {
    if (isPreview) return

    const newSelected = selectedKnowledgeBases.filter((kb) => kb.id !== knowledgeBaseId)
    const selectedIds = newSelected.map((kb) => kb.id)
    const valueToStore = selectedIds.length === 1 ? selectedIds[0] : selectedIds.join(',')

    // Use the hook's setter which handles collaborative updates
    setStoreValue(valueToStore)

    onKnowledgeBaseSelect?.(selectedIds)
  }

  // Use cached data if available
  useEffect(() => {
    if (knowledgeBasesList.length > 0 && !initialFetchDone) {
      setKnowledgeBases(knowledgeBasesList)
      setInitialFetchDone(true)
    }
  }, [knowledgeBasesList, initialFetchDone])

  // If we have a value but no knowledge base info and haven't fetched yet, fetch
  useEffect(() => {
    if (
      value &&
      selectedKnowledgeBases.length === 0 &&
      knowledgeBases.length === 0 &&
      !loading &&
      !initialFetchDone &&
      !isPreview
    ) {
      fetchKnowledgeBases()
    }
  }, [
    value,
    selectedKnowledgeBases.length,
    knowledgeBases.length,
    loading,
    initialFetchDone,
    fetchKnowledgeBases,
    isPreview,
  ])

  const formatKnowledgeBaseName = (knowledgeBase: KnowledgeBaseData) => {
    return knowledgeBase.name
  }

  const getKnowledgeBaseDescription = (knowledgeBase: KnowledgeBaseData) => {
    const docCount = (knowledgeBase as any).docCount
    if (docCount !== undefined) {
      return `${docCount} document${docCount !== 1 ? 's' : ''}`
    }
    return knowledgeBase.description || 'No description'
  }

  const isKnowledgeBaseSelected = (knowledgeBaseId: string) => {
    return selectedKnowledgeBases.some((kb) => kb.id === knowledgeBaseId)
  }

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
              <span className='font-medium text-[#00B0B0]'>{formatKnowledgeBaseName(kb)}</span>
              {!disabled && !isPreview && (
                <button
                  onClick={() => handleRemoveKnowledgeBase(kb.id)}
                  className='ml-1 text-[#00B0B0]/60 hover:text-[#00B0B0]'
                >
                  <X className='h-3 w-3' />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='relative w-full justify-between'
            disabled={disabled || isPreview}
          >
            <div className='flex max-w-[calc(100%-20px)] items-center gap-2 overflow-hidden'>
              <PackageSearchIcon className='h-4 w-4 text-[#00B0B0]' />
              {selectedKnowledgeBases.length > 0 ? (
                <span className='truncate font-normal'>
                  {isMultiSelect
                    ? `${selectedKnowledgeBases.length} selected`
                    : formatKnowledgeBaseName(selectedKnowledgeBases[0])}
                </span>
              ) : (
                <span className='truncate text-muted-foreground'>{label}</span>
              )}
            </div>
            <ChevronDown className='absolute right-3 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[300px] p-0' align='start'>
          <Command>
            <CommandInput placeholder='Search knowledge bases...' />
            <CommandList>
              <CommandEmpty>
                {loading || loadingKnowledgeBasesList ? (
                  <div className='flex items-center justify-center p-4'>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='ml-2'>Loading knowledge bases...</span>
                  </div>
                ) : error ? (
                  <div className='p-4 text-center'>
                    <p className='text-destructive text-sm'>{error}</p>
                  </div>
                ) : (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No knowledge bases found</p>
                    <p className='text-muted-foreground text-xs'>
                      Create a knowledge base to get started.
                    </p>
                  </div>
                )}
              </CommandEmpty>

              {knowledgeBases.length > 0 && (
                <CommandGroup>
                  <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                    Knowledge Bases
                  </div>
                  {knowledgeBases.map((knowledgeBase) => {
                    const isSelected = isKnowledgeBaseSelected(knowledgeBase.id)

                    return (
                      <CommandItem
                        key={knowledgeBase.id}
                        value={`kb-${knowledgeBase.id}-${knowledgeBase.name}`}
                        onSelect={() => {
                          if (isMultiSelect) {
                            handleToggleKnowledgeBase(knowledgeBase)
                          } else {
                            handleSelectSingleKnowledgeBase(knowledgeBase)
                          }
                        }}
                        className='cursor-pointer'
                      >
                        <div className='flex items-center gap-2 overflow-hidden'>
                          <PackageSearchIcon className='h-4 w-4 text-[#00B0B0]' />
                          <div className='min-w-0 flex-1 overflow-hidden'>
                            <div className='truncate font-normal'>
                              {formatKnowledgeBaseName(knowledgeBase)}
                            </div>
                            <div className='truncate text-muted-foreground text-xs'>
                              {getKnowledgeBaseDescription(knowledgeBase)}
                            </div>
                          </div>
                        </div>
                        {isSelected && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
