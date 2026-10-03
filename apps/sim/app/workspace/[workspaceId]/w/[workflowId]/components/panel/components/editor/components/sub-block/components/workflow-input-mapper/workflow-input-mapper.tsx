'use client'

import { useCallback, useMemo } from 'react'
import { Loader } from '@sim/emcn'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { ShortInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import {
  ActiveSearchTargetProvider,
  useActiveSearchTarget,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowState } from '@/hooks/queries/workflows'

interface WorkflowInputMapperProps {
  blockId: string
  subBlock: SubBlockConfig
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
  /** Sibling values, used to read the selected `workflowId` this mapping targets. */
  contextValues?: Record<string, unknown>
}

/**
 * Collects a child workflow's input fields into the single JSON object that
 * `workflow_executor` takes as `inputMapping`.
 *
 * Only reachable through a `context: 'tool-input'` sub-block: on the canvas a child
 * workflow's inputs travel through the `input` variable instead, so this control has no
 * canvas surface. It nonetheless lives here rather than inside `tool-input` so a tool
 * row builds its fields from sub-blocks alone, with no control the canonical renderer
 * cannot render.
 */
export function WorkflowInputMapper({
  blockId,
  subBlock,
  isPreview = false,
  previewValue,
  disabled = false,
  contextValues,
}: WorkflowInputMapperProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)

  const workflowId = typeof contextValues?.workflowId === 'string' ? contextValues.workflowId : ''
  const value = (isPreview ? previewValue : storeValue) ?? ''

  const { data: workflowState, isLoading } = useWorkflowState(workflowId)
  const inputFields = useMemo(
    () => (workflowState?.blocks ? extractInputFieldsFromBlocks(workflowState.blocks) : []),
    [workflowState?.blocks]
  )

  const parsedValue = useMemo((): Record<string, unknown> => {
    if (!value) return {}
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }, [value])

  const handleFieldChange = useCallback(
    (fieldName: string, fieldValue: string) => {
      if (isPreview || disabled) return
      setStoreValue(JSON.stringify({ ...parsedValue, [fieldName]: fieldValue }))
    },
    [parsedValue, setStoreValue, isPreview, disabled]
  )

  if (!workflowId) {
    return (
      <div className='rounded-md border border-[var(--border-1)] border-dashed bg-[var(--surface-3)] p-4 text-center text-[var(--text-muted)] text-sm'>
        Select a workflow to configure its inputs
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center rounded-md border border-[var(--border-1)] border-dashed bg-[var(--surface-3)] p-8'>
        <Loader className='size-5 text-[var(--text-muted)]' animate />
      </div>
    )
  }

  if (inputFields.length === 0) {
    return (
      <div className='rounded-md border border-[var(--border-1)] border-dashed bg-[var(--surface-3)] p-4 text-center text-[var(--text-muted)] text-sm'>
        This workflow has no custom input fields
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      {inputFields.map((field: { name: string; type: string }) => {
        const syntheticId = `${subBlock.id}-${field.name}`
        const fieldActiveSearchTarget =
          activeSearchTarget?.valuePath[0] === field.name
            ? {
                ...activeSearchTarget,
                subBlockId: syntheticId,
                canonicalSubBlockId: syntheticId,
                valuePath: [],
              }
            : null
        return (
          <ActiveSearchTargetProvider key={field.name} value={fieldActiveSearchTarget}>
            <ShortInput
              blockId={blockId}
              subBlockId={syntheticId}
              placeholder={`Enter ${field.name}${field.type !== 'string' ? ` (${field.type})` : ''}`}
              value={String(parsedValue[field.name] ?? '')}
              onChange={(newValue: string) => handleFieldChange(field.name, newValue)}
              disabled={disabled || isPreview}
              config={{
                id: syntheticId,
                type: 'short-input',
                title: field.name,
              }}
            />
          </ActiveSearchTargetProvider>
        )
      })}
    </div>
  )
}
