'use client'

import { useEffect, useRef } from 'react'
import { InlineNotice } from '@sim/emcn/status'
import { SelectorCombobox } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/selector-input/selector-combobox'
import {
  type SubBlockConfig,
  useCollaborativeWorkflow,
  useSelectorSetup,
  useSubBlockValue,
} from '@/platform/lib/data/workflow-editor'
import type { SelectorClientContext } from '@/platform/lib/data/workflow-editor/selectors'

/** Per-type adjustments the dispatcher applies to a selector: its context, or a starting value. */
export interface SelectorOverrides {
  transformContext?: (
    context: SelectorClientContext,
    deps: Record<string, unknown>
  ) => SelectorClientContext
  getDefaultValue?: (subBlock: SubBlockConfig) => string | null
}

interface SelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
  /** Sibling values in preview or inside a tool, in place of the block's stored values. */
  previewContextValues?: Record<string, unknown>
  overrides?: SelectorOverrides
}

/**
 * A sub-block backed by a registered selector: its context comes from the fields it depends on
 * (through their canonical ids), and it stays disabled until those are filled.
 */
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
    if (defaultAppliedRef.current || isPreview || selectorDisabled || storeValue) return
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

  if (!selectorKey) {
    const serviceId = subBlock.serviceId || 'unknown'
    return <InlineNotice message={`Selector not supported for service: ${serviceId}`} />
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
      multiSelect={subBlock.multiSelect}
    />
  )
}
