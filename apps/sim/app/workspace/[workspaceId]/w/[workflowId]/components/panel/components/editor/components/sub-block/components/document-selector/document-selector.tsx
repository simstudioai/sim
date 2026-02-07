'use client'

import { useCallback, useMemo } from 'react'
import { Tooltip } from '@/components/emcn'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext } from '@/hooks/selectors/types'

interface DocumentSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onDocumentSelect?: (documentId: string) => void
  isPreview?: boolean
  previewValue?: string | null
  previewContextValues?: Record<string, unknown>
}

export function DocumentSelector({
  blockId,
  subBlock,
  disabled = false,
  onDocumentSelect,
  isPreview = false,
  previewValue,
  previewContextValues,
}: DocumentSelectorProps) {
  const { finalDisabled } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })
  const [knowledgeBaseIdFromStore] = useSubBlockValue(blockId, 'knowledgeBaseId')
  const knowledgeBaseIdValue = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.knowledgeBaseId)
    : knowledgeBaseIdFromStore
  const normalizedKnowledgeBaseId =
    typeof knowledgeBaseIdValue === 'string' && knowledgeBaseIdValue.trim().length > 0
      ? knowledgeBaseIdValue
      : null

  const selectorContext = useMemo<SelectorContext>(
    () => ({
      knowledgeBaseId: normalizedKnowledgeBaseId ?? undefined,
    }),
    [normalizedKnowledgeBaseId]
  )

  const handleDocumentChange = useCallback(
    (documentId: string) => {
      if (isPreview) return
      onDocumentSelect?.(documentId)
    },
    [isPreview, onDocumentSelect]
  )

  const missingKnowledgeBase = !normalizedKnowledgeBaseId
  const isDisabled = finalDisabled || missingKnowledgeBase
  const placeholder = subBlock.placeholder || 'Select document'

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div className='w-full'>
          <SelectorCombobox
            blockId={blockId}
            subBlock={subBlock}
            selectorKey='knowledge.documents'
            selectorContext={selectorContext}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue ?? null}
            placeholder={placeholder}
            onOptionChange={handleDocumentChange}
          />
        </div>
      </Tooltip.Trigger>
      {missingKnowledgeBase && (
        <Tooltip.Content side='top'>
          <p>Select a knowledge base first.</p>
        </Tooltip.Content>
      )}
    </Tooltip.Root>
  )
}
