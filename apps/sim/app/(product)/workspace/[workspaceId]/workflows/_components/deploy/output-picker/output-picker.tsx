'use client'

import { useMemo } from 'react'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { BlockTile } from '@/app/(product)/_components/workspace/workflows/canvas/block-tile/block-tile'
import { useWorkflowOutputOptions } from '@/platform/lib/data/workflow-editor/selectors'

interface OutputPickerProps {
  workflowId: string | null
  label: string
  /** Stored selections: internal ids or display labels, both of which a legacy value may hold. */
  value: readonly string[]
  onValueChange: (value: string[]) => void
  /** What a selection stores: the internal id (chat) or the display label (the API's examples). */
  valueMode: 'id' | 'label'
  placeholder?: string
  disabled?: boolean
  error?: string
}

/**
 * Picks block outputs of the open workflow and of the workflows its Workflow blocks call, as the
 * legacy chat and API output selectors did.
 */
export function OutputPicker({
  workflowId,
  label,
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
        value: valueMode === 'label' ? output.label : output.id,
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
          (candidate) => candidate.id === stored || candidate.label === stored
        )
        if (!output) return []
        return [valueMode === 'label' ? output.label : output.id]
      }),
    [value, outputs, valueMode]
  )
  return (
    <MultiSelect
      label={label}
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
