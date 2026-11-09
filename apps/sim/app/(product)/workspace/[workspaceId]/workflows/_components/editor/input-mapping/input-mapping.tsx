'use client'

import { useId, useMemo, useState } from 'react'
import { FieldFrame } from '@sim/emcn/field'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { EntryCard } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/entry-card/entry-card'
import { getActiveWorkflowSearchHighlight } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/input-mapping/input-mapping.module.css'
import { ReferenceField } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field'
import {
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
  /** Sibling values in a preview, raw or `{ value }`-wrapped, that resolve the selected workflow. */
  previewContextValues?: Record<string, unknown>
}

/** The stored mapping as an object of field name to value, from an object or its JSON string. */
function parseMapping(value: unknown): Record<string, string> {
  if (value && typeof value === 'object') return value as Record<string, string>
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string>
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * The Workflow block's input values: one field for each input the selected child workflow's start
 * declares, each taking a value or a `<reference>`, stored as one object keyed by input name.
 */
export function InputMapping({
  blockId,
  subBlock,
  isPreview = false,
  previewValue,
  disabled = false,
  previewContextValues,
}: InputMappingProps) {
  const baseId = useId()
  const activeSearchTarget = useActiveSearchTarget()
  const subBlockId = subBlock.id
  const [mapping, setMapping] = useSubBlockValue(blockId, subBlockId)
  const { dependencyValues } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })
  const selectedWorkflowId = dependencyValues.workflowId
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
  const { data: workflowState, isLoading } = useWorkflowState(workflowId)
  const childInputFields = useMemo(
    () => (workflowState?.blocks ? extractInputFieldsFromBlocks(workflowState.blocks) : []),
    [workflowState?.blocks]
  )
  const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})

  const values =
    isPreview && previewValue && typeof previewValue === 'object'
      ? (previewValue as Record<string, string>)
      : parseMapping(mapping)

  const searchedField =
    activeSearchTarget?.subBlockId === subBlockId ? activeSearchTarget.valuePath[0] : undefined
  if (typeof searchedField === 'string' && collapsedFields[searchedField]) {
    setCollapsedFields((prev) => ({ ...prev, [searchedField]: false }))
  }

  const updateField = (name: string, value: string) => {
    if (disabled) return
    setMapping({ ...values, [name]: value })
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
