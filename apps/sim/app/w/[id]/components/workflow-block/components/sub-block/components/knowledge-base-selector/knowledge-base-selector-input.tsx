'use client'

import { useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { SubBlockConfig } from '@/blocks/types'
import type { KnowledgeBaseData } from '@/stores/knowledge/knowledge'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { KnowledgeBaseSelector } from './components/knowledge-base-selector'

interface KnowledgeBaseSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onKnowledgeBaseSelect?: (knowledgeBaseId: string) => void
  isPreview?: boolean
  previewValue?: string | null
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
  const [knowledgeBaseInfo, setKnowledgeBaseInfo] = useState<KnowledgeBaseData | null>(null)

  // Get the current value from the store
  const storeValue = getValue(blockId, subBlock.id)

  // Handle knowledge base selection
  const handleKnowledgeBaseChange = (knowledgeBaseId: string, info?: KnowledgeBaseData) => {
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
              value={storeValue}
              onChange={(knowledgeBaseId: string, knowledgeBaseInfo?: KnowledgeBaseData) => {
                handleKnowledgeBaseChange(knowledgeBaseId, knowledgeBaseInfo)
              }}
              label={subBlock.placeholder || 'Select knowledge base'}
              disabled={disabled}
              isPreview={isPreview}
              previewValue={previewValue}
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
