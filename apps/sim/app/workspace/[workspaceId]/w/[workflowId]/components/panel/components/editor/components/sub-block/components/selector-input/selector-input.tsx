'use client'

import { useEffect, useRef } from 'react'
import { Tooltip } from '@/components/emcn'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useSelectorSetup } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-selector-setup'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext } from '@/hooks/selectors/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'

export interface SelectorOverrides {
  transformContext?: (context: SelectorContext, deps: Record<string, unknown>) => SelectorContext
  getDefaultValue?: (subBlock: SubBlockConfig) => string | null
}

interface SelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: any
  previewContextValues?: Record<string, any>
  overrides?: SelectorOverrides
}

export function SelectorInput({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
  overrides,
}: SelectorInputProps) {
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const [storeValue] = useSubBlockValue(blockId, subBlock.id)
  const defaultAppliedRef = useRef(false)

  const {
    selectorKey,
    selectorContext: autoContext,
    allowSearch,
    disabled: selectorDisabled,
    dependencyValues,
  } = useSelectorSetup(blockId, subBlock, { disabled, isPreview, previewContextValues })

  const selectorContext = overrides?.transformContext
    ? overrides.transformContext(autoContext, dependencyValues)
    : autoContext

  useEffect(() => {
    if (defaultAppliedRef.current || isPreview || selectorDisabled) return
    if (storeValue) return

    const defaultValue = overrides?.getDefaultValue?.(subBlock)
    if (defaultValue) {
      defaultAppliedRef.current = true
      collaborativeSetSubblockValue(blockId, subBlock.id, defaultValue)
    }
  }, [
    blockId,
    subBlock,
    storeValue,
    isPreview,
    selectorDisabled,
    overrides,
    collaborativeSetSubblockValue,
  ])

  const serviceId = subBlock.serviceId || 'unknown'

  if (!selectorKey) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className='w-full rounded border p-4 text-center text-muted-foreground text-sm'>
            Selector not supported for service: {serviceId}
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          <p>This selector is not implemented for {serviceId}</p>
        </Tooltip.Content>
      </Tooltip.Root>
    )
  }

  return (
    <SelectorCombobox
      blockId={blockId}
      subBlock={subBlock}
      selectorKey={selectorKey}
      selectorContext={selectorContext}
      disabled={selectorDisabled}
      isPreview={isPreview}
      previewValue={previewValue ?? null}
      placeholder={subBlock.placeholder || 'Select resource'}
      allowSearch={allowSearch}
      onOptionChange={(value) => {
        if (!isPreview) {
          collaborativeSetSubblockValue(blockId, subBlock.id, value)
        }
      }}
    />
  )
}
