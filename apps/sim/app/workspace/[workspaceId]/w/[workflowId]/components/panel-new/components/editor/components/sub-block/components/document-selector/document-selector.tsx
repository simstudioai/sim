'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, FileText, RefreshCw } from 'lucide-react'
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
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useKnowledgeBaseDocuments } from '@/hooks/use-knowledge'
import { useDisplayNamesStore } from '@/stores/display-names/store'
import type { DocumentData } from '@/stores/knowledge/store'

interface DocumentSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onDocumentSelect?: (documentId: string) => void
  isPreview?: boolean
  previewValue?: string | null
}

export function DocumentSelector({
  blockId,
  subBlock,
  disabled = false,
  onDocumentSelect,
  isPreview = false,
  previewValue,
}: DocumentSelectorProps) {
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [knowledgeBaseId] = useSubBlockValue(blockId, 'knowledgeBaseId')
  const normalizedKnowledgeBaseId =
    typeof knowledgeBaseId === 'string' && knowledgeBaseId.trim().length > 0
      ? knowledgeBaseId
      : null

  const value = isPreview ? previewValue : storeValue

  const { finalDisabled } = useDependsOnGate(blockId, subBlock, { disabled, isPreview })
  const isDisabled = finalDisabled

  const {
    documents,
    isLoading: documentsLoading,
    error: documentsError,
    refreshDocuments,
  } = useKnowledgeBaseDocuments(normalizedKnowledgeBaseId ?? '', {
    limit: 500,
    offset: 0,
    enabled: open && Boolean(normalizedKnowledgeBaseId),
  })

  const handleOpenChange = (isOpen: boolean) => {
    if (isPreview || isDisabled) return

    setOpen(isOpen)

    if (isOpen && normalizedKnowledgeBaseId) {
      void refreshDocuments()
    }
  }

  const handleSelectDocument = (document: DocumentData) => {
    if (isPreview) return

    setStoreValue(document.id)
    onDocumentSelect?.(document.id)
    setOpen(false)
  }

  useEffect(() => {
    if (!normalizedKnowledgeBaseId) {
      setError(null)
    }
  }, [normalizedKnowledgeBaseId])

  useEffect(() => {
    setError(documentsError)
  }, [documentsError])

  useEffect(() => {
    if (!normalizedKnowledgeBaseId || documents.length === 0) return

    const documentMap = documents.reduce<Record<string, string>>((acc, doc) => {
      acc[doc.id] = doc.filename
      return acc
    }, {})

    useDisplayNamesStore
      .getState()
      .setDisplayNames('documents', normalizedKnowledgeBaseId as string, documentMap)
  }, [documents, normalizedKnowledgeBaseId])

  const formatDocumentName = (document: DocumentData) => document.filename

  const getDocumentDescription = (document: DocumentData) => {
    const statusMap: Record<string, string> = {
      pending: 'Processing pending',
      processing: 'Processing...',
      completed: 'Ready',
      failed: 'Processing failed',
    }

    const status = statusMap[document.processingStatus] || document.processingStatus
    const chunkText = `${document.chunkCount} chunk${document.chunkCount !== 1 ? 's' : ''}`

    return `${status} • ${chunkText}`
  }

  const label = subBlock.placeholder || 'Select document'
  const isLoading = documentsLoading && !error

  // Always use cached display name
  const displayName = useDisplayNamesStore(
    useCallback(
      (state) => {
        if (!normalizedKnowledgeBaseId || !value || typeof value !== 'string') return null
        return state.cache.documents[normalizedKnowledgeBaseId]?.[value] || null
      },
      [normalizedKnowledgeBaseId, value]
    )
  )

  return (
    <div className='w-full'>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='relative w-full justify-between'
            disabled={isDisabled}
          >
            <div className='flex max-w-[calc(100%-20px)] items-center gap-2 overflow-hidden'>
              <FileText className='h-4 w-4 text-muted-foreground' />
              {displayName ? (
                <span className='truncate font-normal'>{displayName}</span>
              ) : (
                <span className='truncate text-muted-foreground'>{label}</span>
              )}
            </div>
            <ChevronDown className='absolute right-3 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[300px] p-0' align='start'>
          <Command>
            <CommandInput placeholder='Search documents...' />
            <CommandList>
              <CommandEmpty>
                {isLoading ? (
                  <div className='flex items-center justify-center p-4'>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='ml-2'>Loading documents...</span>
                  </div>
                ) : error ? (
                  <div className='p-4 text-center'>
                    <p className='text-destructive text-sm'>{error}</p>
                  </div>
                ) : !normalizedKnowledgeBaseId ? (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No knowledge base selected</p>
                    <p className='text-muted-foreground text-xs'>
                      Please select a knowledge base first.
                    </p>
                  </div>
                ) : (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No documents found</p>
                    <p className='text-muted-foreground text-xs'>
                      Upload documents to this knowledge base to get started.
                    </p>
                  </div>
                )}
              </CommandEmpty>

              {documents.length > 0 && (
                <CommandGroup>
                  <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                    Documents
                  </div>
                  {documents.map((document) => (
                    <CommandItem
                      key={document.id}
                      value={`doc-${document.id}-${document.filename}`}
                      onSelect={() => handleSelectDocument(document)}
                      className='cursor-pointer'
                    >
                      <div className='flex items-center gap-2 overflow-hidden'>
                        <FileText className='h-4 w-4 text-muted-foreground' />
                        <div className='min-w-0 flex-1 overflow-hidden'>
                          <div className='truncate font-normal'>{formatDocumentName(document)}</div>
                          <div className='truncate text-muted-foreground text-xs'>
                            {getDocumentDescription(document)}
                          </div>
                        </div>
                      </div>
                      {document.id === value && <Check className='ml-auto h-4 w-4' />}
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
