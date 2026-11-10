'use client'

import { useMemo } from 'react'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { BlockTile } from '@/app/(product)/_components/workspace/workflows/canvas/block-tile/block-tile'
import { useSubBlockValue, useWorkflowRegistry } from '@/platform/lib/data/workflow-editor'
import {
  publicOutputValue,
  useWorkflowOutputOptions,
} from '@/platform/lib/data/workflow-editor/selectors'

type WorkflowOutputOption = ReturnType<typeof useWorkflowOutputOptions>[number]

/**
 * What a selection stores: the internal id (chat), the display label (the API's examples), or the
 * public `block.path` selector (a block's streamed outputs).
 */
type OutputValueMode = 'id' | 'label' | 'public'

function storedValue(output: WorkflowOutputOption, mode: OutputValueMode): string {
  if (mode === 'label') return output.label
  if (mode === 'id') return output.id
  return publicOutputValue(output)
}

const NO_OUTPUTS: string[] = []

interface OutputPickerProps {
  workflowId: string | null
  label: string
  /** Shows the label to assistive technology only, as a sub-block's own title already names it. */
  labelHidden?: boolean
  /** Stored selections, in any of the forms a legacy value may hold; each is rewritten in `valueMode`. */
  value: readonly string[]
  onValueChange: (value: string[]) => void
  valueMode: OutputValueMode
  placeholder?: string
  disabled?: boolean
  error?: string
}

/**
 * Picks block outputs of the open workflow and of the workflows its Workflow blocks call, each named
 * by its path through them.
 */
export function OutputPicker({
  workflowId,
  label,
  labelHidden,
  value,
  onValueChange,
  valueMode,
  placeholder = 'Select outputs',
  disabled,
  error,
}: OutputPickerProps) {
  const outputs = useWorkflowOutputOptions(workflowId)
  const options = useMemo(
    () =>
      outputs.map((output) => ({
        value: storedValue(output, valueMode),
        label: `${output.groupLabel} · ${output.path}`,
        leading: (
          <BlockTile
            size='sm'
            blockType={output.blockType}
            fallbackLabel={output.blockName.charAt(0).toUpperCase()}
          />
        ),
      })),
    [outputs, valueMode]
  )
  const selected = useMemo(
    () =>
      value.flatMap((stored) => {
        const output = outputs.find(
          (candidate) =>
            candidate.id === stored ||
            candidate.label === stored ||
            publicOutputValue(candidate) === stored
        )
        return output ? [storedValue(output, valueMode)] : []
      }),
    [value, outputs, valueMode]
  )
  return (
    <MultiSelect
      label={label}
      labelHidden={labelHidden}
      options={options}
      value={selected}
      onValueChange={onValueChange}
      placeholder={placeholder}
      searchLabel='Search outputs'
      disabled={disabled || outputs.length === 0}
      error={error}
    />
  )
}

interface SubBlockOutputPickerProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  placeholder?: string
}

/** The outputs a workflow streams back, held in a block's sub-block as public selectors. */
export function SubBlockOutputPicker({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  placeholder,
}: SubBlockOutputPickerProps) {
  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const [stored, setStored] = useSubBlockValue<string[]>(blockId, subBlockId)
  const source = isPreview ? previewValue : stored
  return (
    <OutputPicker
      workflowId={workflowId}
      label='Outputs'
      labelHidden
      value={Array.isArray(source) ? source.map(String) : NO_OUTPUTS}
      onValueChange={(values) => {
        if (!isPreview && !disabled) setStored(values)
      }}
      valueMode='public'
      placeholder={placeholder}
      disabled={disabled || isPreview}
    />
  )
}
