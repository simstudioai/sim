'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
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
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

interface KnowledgeBaseSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onKnowledgeBaseSelect?: (knowledgeBaseId: string) => void
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
  const { getValue, setValue } = useSubBlockStore()

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState<KnowledgeBaseData | null>(null)
  const [initialFetchDone, setInitialFetchDone] = useState(false)
  const [knowledgeBaseInfo, setKnowledgeBaseInfo] = useState<KnowledgeBaseData | null>(null)

  // Get the current value from the store
  const storeValue = getValue(blockId, subBlock.id)

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

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

  // Handle knowledge base selection
  const handleSelectKnowledgeBase = (knowledgeBase: KnowledgeBaseData) => {
    if (isPreview) return

    setSelectedKnowledgeBase(knowledgeBase)
    setKnowledgeBaseInfo(knowledgeBase)

    if (!isPreview) {
      setValue(blockId, subBlock.id, knowledgeBase.id)
    }

    onKnowledgeBaseSelect?.(knowledgeBase.id)
    setOpen(false)
  }

  // Sync selected knowledge base with value prop
  useEffect(() => {
    if (value && knowledgeBases.length > 0) {
      const kbInfo = knowledgeBases.find((kb) => kb.id === value)
      if (kbInfo) {
        setSelectedKnowledgeBase(kbInfo)
        setKnowledgeBaseInfo(kbInfo)
      } else {
        setSelectedKnowledgeBase(null)
        setKnowledgeBaseInfo(null)
      }
    } else if (!value) {
      setSelectedKnowledgeBase(null)
      setKnowledgeBaseInfo(null)
    }
  }, [value, knowledgeBases])

  // Use cached data if available
  useEffect(() => {
    if (knowledgeBasesList.length > 0 && !initialFetchDone) {
      setKnowledgeBases(knowledgeBasesList)
      setInitialFetchDone(true)
    }
  }, [knowledgeBasesList, initialFetchDone])

  // If we have a value but no knowledge base info and haven't fetched yet, fetch
  useEffect(() => {
    if (value && !selectedKnowledgeBase && !loading && !initialFetchDone && !isPreview) {
      fetchKnowledgeBases()
    }
  }, [value, selectedKnowledgeBase, loading, initialFetchDone, fetchKnowledgeBases, isPreview])

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

  const label = subBlock.placeholder || 'Select knowledge base'

  return (
    <div className='w-full'>
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
              {selectedKnowledgeBase ? (
                <span className='truncate font-normal'>
                  {formatKnowledgeBaseName(selectedKnowledgeBase)}
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
                  {knowledgeBases.map((knowledgeBase) => (
                    <CommandItem
                      key={knowledgeBase.id}
                      value={`kb-${knowledgeBase.id}-${knowledgeBase.name}`}
                      onSelect={() => handleSelectKnowledgeBase(knowledgeBase)}
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
                      {knowledgeBase.id === value && <Check className='ml-auto h-4 w-4' />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
