'use client'

import { useMemo } from 'react'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { BlockTile } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/block-tile/block-tile'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/workflow-output-selector/workflow-output-selector.module.css'
import { useSubBlockValue, useWorkflowRegistry } from '@/platform/lib/data/workflow-editor'
import {
  publicOutputValue,
  useWorkflowOutputOptions,
} from '@/platform/lib/data/workflow-editor/selectors'

const NO_OUTPUTS: string[] = []

interface WorkflowOutputSelectorProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  placeholder?: string
}

/**
 * Picks the outputs a workflow streams back: every block's outputs, and those of the workflows its
 * Workflow blocks call, each named by its path through them. It stores public `block.path`
 * selectors, and a value saved as an internal id or label is read and rewritten in that form.
 */
export function WorkflowOutputSelector({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  placeholder = 'Select outputs',
}: WorkflowOutputSelectorProps) {
  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const [storedValue, setStoredValue] = useSubBlockValue<string[]>(blockId, subBlockId)
  const source = isPreview ? previewValue : storedValue
  const selectedOutputs = useMemo(
    () => (Array.isArray(source) ? source.map(String) : NO_OUTPUTS),
    [source]
  )
  const outputs = useWorkflowOutputOptions(workflowId)

  const options = useMemo(
    () =>
      outputs.map((output) => ({
        value: publicOutputValue(output),
        label: `${output.groupLabel} · ${output.path}`,
        leading: (
          <BlockTile
            size='sm'
            blockType={output.blockType}
            fallbackLabel={output.blockName.charAt(0).toUpperCase()}
          />
        ),
      })),
    [outputs]
  )
  const selected = useMemo(
    () =>
      selectedOutputs.flatMap((stored) => {
        const output = outputs.find(
          (candidate) =>
            candidate.id === stored ||
            candidate.label === stored ||
            publicOutputValue(candidate) === stored
        )
        return output ? [publicOutputValue(output)] : []
      }),
    [selectedOutputs, outputs]
  )
  return (
    <div className={styles.picker}>
      <MultiSelect
        label='Outputs'
        labelHidden
        options={options}
        value={selected}
        onValueChange={(values) => {
          if (!isPreview && !disabled) setStoredValue(values)
        }}
        placeholder={placeholder}
        searchLabel='Search outputs'
        disabled={disabled || isPreview || outputs.length === 0}
      />
    </div>
  )
}
