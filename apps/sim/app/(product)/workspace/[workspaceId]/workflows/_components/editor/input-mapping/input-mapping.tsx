'use client'

import { useId, useMemo, useState } from 'react'
import { FieldFrame } from '@sim/emcn/field'
import { FailureNotice } from '@sim/emcn/status'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { EntryCard } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/entry-card/entry-card'
import { getActiveWorkflowSearchHighlight } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/input-mapping/input-mapping.module.css'
import { ReferenceField } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field'
import {
  resolvePreviewContextValue,
  type SubBlockConfig,
  useAccessibleReferencePrefixes,
  useDependsOnGate,
  useSubBlockInput,
  useSubBlockValue,
  useWorkflowState,
} from '@/platform/lib/data/workflow-editor'
import { extractInputFieldsFromBlocks } from '@/platform/lib/data/workflow-editor/structured'

interface InputMappingProps {
  blockId: string
  subBlock: SubBlockConfig
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  /** Sibling values, raw or `{ value }`-wrapped, that resolve the selected workflow. */
  contextValues?: Record<string, unknown>
  /**
   * How the mapping is stored: an object, as the Workflow block keeps it, or the JSON string
   * `workflow_executor` takes as `inputMapping` inside a tool's parameters.
   */
  storage?: 'object' | 'json'
}

/** The stored mapping as an object of field name to value, from an object or its JSON string. */
function parseMapping(value: unknown): Record<string, string> {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return {}
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, string>)
    : {}
}

/**
 * A child workflow's input values: one field for each input its start declares, each taking a
 * value or a `<reference>`, stored as one mapping keyed by input name.
 */
export function InputMapping({
  blockId,
  subBlock,
  isPreview = false,
  previewValue,
  disabled = false,
  contextValues,
  storage = 'object',
}: InputMappingProps) {
  const baseId = useId()
  const activeSearchTarget = useActiveSearchTarget()
  const subBlockId = subBlock.id
  const [mapping, setMapping] = useSubBlockValue(blockId, subBlockId)
  const { dependencyValues } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues: contextValues,
  })
  const selectedWorkflowId =
    dependencyValues.workflowId ?? resolvePreviewContextValue(contextValues?.workflowId)
  const controllerConfig = useMemo<SubBlockConfig>(
    () => ({ id: subBlockId, type: 'input-mapping', connectionDroppable: true }),
    [subBlockId]
  )
  const controller = useSubBlockInput({
    blockId,
    subBlockId,
    config: controllerConfig,
    isPreview,
    disabled,
  })
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const workflowId = typeof selectedWorkflowId === 'string' ? selectedWorkflowId : undefined
  const {
    data: workflowState,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useWorkflowState(workflowId)
  const childInputFields = useMemo(
    () => (workflowState?.blocks ? extractInputFieldsFromBlocks(workflowState.blocks) : []),
    [workflowState?.blocks]
  )
  const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})

  const values = parseMapping(isPreview ? previewValue : mapping)

  const searchedField =
    activeSearchTarget?.subBlockId === subBlockId ? activeSearchTarget.valuePath[0] : undefined
  if (typeof searchedField === 'string' && collapsedFields[searchedField]) {
    setCollapsedFields((prev) => ({ ...prev, [searchedField]: false }))
  }

  const updateField = (name: string, value: string) => {
    if (disabled || isPreview) return
    const next = { ...values, [name]: value }
    setMapping(storage === 'json' ? JSON.stringify(next) : next)
  }

  if (!selectedWorkflowId) {
    return (
      <div className={styles.note}>
        <span className={styles.noteTitle} data-type='T060'>
          No workflow selected
        </span>
        <span data-type='T052'>Select a workflow above to configure inputs</span>
      </div>
    )
  }

  if (isLoading) return null

  if (isError) {
    return (
      <FailureNotice
        message="Could not read this workflow's inputs."
        retrying={isFetching}
        onRetry={() => void refetch()}
      />
    )
  }

  if (childInputFields.length === 0) {
    return (
      <p className={styles.note} data-type='T052'>
        No inputs available
      </p>
    )
  }

  return (
    <div className={styles.entries}>
      {childInputFields.map((field, index) => {
        const fieldId = `${baseId}-${index}`
        const collapsed = collapsedFields[field.name] ?? false
        return (
          <EntryCard
            key={field.name}
            label={field.name}
            title={field.name}
            typeTag={field.type || undefined}
            collapsed={collapsed}
            onToggle={() => setCollapsedFields((prev) => ({ ...prev, [field.name]: !collapsed }))}
          >
            <FieldFrame id={fieldId} label='Value'>
              <ReferenceField
                id={fieldId}
                label={field.name}
                blockId={blockId}
                value={values[field.name] || ''}
                onChange={(next) => updateField(field.name, next)}
                controller={controller}
                fieldKey={field.name}
                placeholder='Enter value or reference'
                disabled={isPreview || disabled}
                accessiblePrefixes={accessiblePrefixes}
                searchHighlight={getActiveWorkflowSearchHighlight({
                  activeSearchTarget,
                  subBlockId,
                  valuePath: [field.name],
                })}
              />
            </FieldFrame>
          </EntryCard>
        )
      })}
    </div>
  )
}
