'use client'

import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { SubBlockConfig } from '@/blocks/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { type KnowledgeBaseInfo, KnowledgeBaseSelector } from './components/knowledge-base-selector'

interface KnowledgeBaseSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onKnowledgeBaseSelect?: (knowledgeBaseId: string) => void
  isPreview?: boolean
  previewValue?: any | null
}

export function KnowledgeBaseSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onKnowledgeBaseSelect,
  isPreview = false,
  previewValue,
}: KnowledgeBaseSelectorInputProps) {
  const { getValue, setValue } = useSubBlockStore()
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<string>('')
  const [_knowledgeBaseInfo, setKnowledgeBaseInfo] = useState<KnowledgeBaseInfo | null>(null)

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : getValue(blockId, subBlock.id)

  // Get the current value from the store or prop value if in preview mode
  useEffect(() => {
    if (isPreview && previewValue !== undefined) {
      const value = previewValue
      if (value && typeof value === 'string') {
        setSelectedKnowledgeBaseId(value)
      }
    } else {
      const value = getValue(blockId, subBlock.id)
      if (value && typeof value === 'string') {
        setSelectedKnowledgeBaseId(value)
      }
    }
  }, [blockId, subBlock.id, getValue, isPreview, previewValue])

  // Handle knowledge base selection
  const handleKnowledgeBaseChange = (knowledgeBaseId: string, info?: KnowledgeBaseInfo) => {
    setSelectedKnowledgeBaseId(knowledgeBaseId)
    setKnowledgeBaseInfo(info || null)
    if (!isPreview) {
      setValue(blockId, subBlock.id, knowledgeBaseId)
    }
    onKnowledgeBaseSelect?.(knowledgeBaseId)
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className='w-full'>
            <KnowledgeBaseSelector
              value={selectedKnowledgeBaseId}
              onChange={(knowledgeBaseId: string, knowledgeBaseInfo?: KnowledgeBaseInfo) => {
                handleKnowledgeBaseChange(knowledgeBaseId, knowledgeBaseInfo)
              }}
              label={subBlock.placeholder || 'Select knowledge base'}
              disabled={disabled}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side='top'>
          <p>Select a knowledge base to search</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
