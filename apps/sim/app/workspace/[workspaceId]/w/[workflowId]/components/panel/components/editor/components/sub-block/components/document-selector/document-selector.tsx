'use client'

import { useCallback, useMemo } from 'react'
import { Tooltip } from '@/components/emcn'
import { buildCanonicalIndex, resolveDependencyValue } from '@/lib/workflows/subblocks/visibility'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext } from '@/hooks/selectors/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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
  const { activeWorkflowId } = useWorkflowRegistry()

  const { finalDisabled } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })

  const blockState = useWorkflowStore((state) => state.blocks[blockId])
  const blockConfig = blockState?.type ? getBlock(blockState.type) : null
  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(blockConfig?.subBlocks || []),
    [blockConfig?.subBlocks]
  )
  const canonicalModeOverrides = blockState?.data?.canonicalModes

  const blockValues = useSubBlockStore((state) => {
    if (!activeWorkflowId) return {}
    const workflowValues = state.workflowValues[activeWorkflowId] || {}
    return (workflowValues as Record<string, Record<string, unknown>>)[blockId] || {}
  })

  const knowledgeBaseIdValue = useMemo(
    () =>
      previewContextValues
        ? resolvePreviewContextValue(previewContextValues.knowledgeBaseId)
        : resolveDependencyValue(
            'knowledgeBaseId',
            blockValues,
            canonicalIndex,
            canonicalModeOverrides
          ),
    [previewContextValues, blockValues, canonicalIndex, canonicalModeOverrides]
  )

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
