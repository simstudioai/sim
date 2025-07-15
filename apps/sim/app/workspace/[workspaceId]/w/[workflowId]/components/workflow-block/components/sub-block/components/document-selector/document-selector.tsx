'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, FileText } from 'lucide-react'
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
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

interface DocumentData {
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: string
  processingStartedAt: Date | null
  processingCompletedAt: Date | null
  processingError: string | null
  enabled: boolean
  uploadedAt: Date
}

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
  const [documents, setDocuments] = useState<DocumentData[]>([])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedDocument, setSelectedDocument] = useState<DocumentData | null>(null)

  // Use the proper hook to get the current value and setter
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Get the knowledge base ID from the same block's knowledgeBaseId subblock
  const [knowledgeBaseId] = useSubBlockValue(blockId, 'knowledgeBaseId')

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // Fetch documents for the selected knowledge base
  const fetchDocuments = useCallback(async () => {
    if (!knowledgeBaseId) {
      setDocuments([])
      setError('No knowledge base selected')
      return
    }

    setError(null)

    try {
      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents`)

      if (!response.ok) {
        throw new Error(`Failed to fetch documents: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch documents')
      }

      const fetchedDocuments = result.data.documents || result.data || []
      setDocuments(fetchedDocuments)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message)
      setDocuments([])
    }
  }, [knowledgeBaseId])

  // Handle dropdown open/close - fetch documents when opening
  const handleOpenChange = (isOpen: boolean) => {
    if (isPreview) return

    setOpen(isOpen)

    // Fetch fresh documents when opening the dropdown
    if (isOpen) {
      fetchDocuments()
    }
  }

  // Handle document selection
  const handleSelectDocument = (document: DocumentData) => {
    if (isPreview) return

    setSelectedDocument(document)
    setStoreValue(document.id)
    onDocumentSelect?.(document.id)
    setOpen(false)
  }

  // Sync selected document with value prop
  useEffect(() => {
    if (value && documents.length > 0) {
      const docInfo = documents.find((doc) => doc.id === value)
      setSelectedDocument(docInfo || null)
    } else {
      setSelectedDocument(null)
    }
  }, [value, documents])

  // Reset documents when knowledge base changes
  useEffect(() => {
    setDocuments([])
    setSelectedDocument(null)
    setError(null)
  }, [knowledgeBaseId])

  // Fetch documents when knowledge base is available
  useEffect(() => {
    if (knowledgeBaseId && !isPreview) {
      fetchDocuments()
    }
  }, [knowledgeBaseId, isPreview, fetchDocuments])

  const formatDocumentName = (document: DocumentData) => {
    return document.filename
  }

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

  // Show disabled state if no knowledge base is selected
  const isDisabled = disabled || isPreview || !knowledgeBaseId

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
              {selectedDocument ? (
                <span className='truncate font-normal'>{formatDocumentName(selectedDocument)}</span>
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
                {error ? (
                  <div className='p-4 text-center'>
                    <p className='text-destructive text-sm'>{error}</p>
                  </div>
                ) : !knowledgeBaseId ? (
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
