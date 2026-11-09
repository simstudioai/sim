'use client'

import { useMemo } from 'react'
import { FieldFrame } from '@sim/emcn/field'
import {
  ActiveSearchTargetProvider,
  useActiveSearchTarget,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { ShortInput } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/short-input/short-input'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/workflow-input-mapper/workflow-input-mapper.module.css'
import {
  resolvePreviewContextValue,
  type SubBlockConfig,
  useSubBlockValue,
  useWorkflowState,
} from '@/platform/lib/data/workflow-editor'
import { extractInputFieldsFromBlocks } from '@/platform/lib/data/workflow-editor/structured'

interface WorkflowInputMapperProps {
  blockId: string
  subBlock: SubBlockConfig
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  /** Sibling values, raw or `{ value }`-wrapped, holding the `workflowId` this mapping targets. */
  contextValues?: Record<string, unknown>
}

/** The stored mapping's JSON object, or an empty one for anything else. */
function parseMapping(value: string): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Collects a child workflow's inputs into the one JSON object `workflow_executor` takes as
 * `inputMapping`. It renders only inside a tool's parameters: on the canvas a child workflow's
 * inputs travel through the `input` variable.
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

  const resolvedWorkflowId = resolvePreviewContextValue(contextValues?.workflowId)
  const workflowId = typeof resolvedWorkflowId === 'string' ? resolvedWorkflowId : ''
  const rawValue = isPreview ? previewValue : storeValue
  const value = typeof rawValue === 'string' ? rawValue : ''

  const { data: workflowState, isLoading } = useWorkflowState(workflowId)
  const inputFields = useMemo(
    () => (workflowState?.blocks ? extractInputFieldsFromBlocks(workflowState.blocks) : []),
    [workflowState?.blocks]
  )
  const parsedValue = useMemo(() => parseMapping(value), [value])

  const changeField = (fieldName: string, fieldValue: string) => {
    if (isPreview || disabled) return
    setStoreValue(JSON.stringify({ ...parsedValue, [fieldName]: fieldValue }))
  }

  if (!workflowId) {
    return (
      <p className={styles.note} data-type='T052'>
        Select a workflow to configure its inputs
      </p>
    )
  }

  if (isLoading) return null

  if (inputFields.length === 0) {
    return (
      <p className={styles.note} data-type='T052'>
        This workflow has no custom input fields
      </p>
    )
  }

  return (
    <div className={styles.fields}>
      {inputFields.map((field) => {
        const syntheticId = `${subBlock.id}-${field.name}`
        const fieldSearchTarget =
          activeSearchTarget?.valuePath[0] === field.name
            ? {
                ...activeSearchTarget,
                subBlockId: syntheticId,
                canonicalSubBlockId: syntheticId,
                valuePath: [],
              }
            : null
        return (
          <FieldFrame key={field.name} label={field.name}>
            <ActiveSearchTargetProvider value={fieldSearchTarget}>
              <ShortInput
                blockId={blockId}
                subBlockId={syntheticId}
                placeholder={`Enter ${field.name}${field.type !== 'string' ? ` (${field.type})` : ''}`}
                value={String(parsedValue[field.name] ?? '')}
                onChange={(next) => changeField(field.name, next)}
                disabled={disabled || isPreview}
                config={{ id: syntheticId, type: 'short-input', title: field.name }}
              />
            </ActiveSearchTargetProvider>
          </FieldFrame>
        )
      })}
    </div>
  )
}
