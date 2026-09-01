import { useCallback } from 'react'
import { Checkbox, Label, Tooltip } from '@sim/emcn'
import { CircleInfo } from '@sim/emcn/icons'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'

interface CheckboxListOption {
  label: string
  id: string
  defaultChecked?: boolean
  description?: string
}

interface CheckboxListProps {
  blockId: string
  subBlockId: string
  options: CheckboxListOption[]
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
}

/** The stored selections, tolerating the `null` a never-touched field holds. */
function readSelections(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, boolean>
}

/**
 * A group of boolean options collected under one field.
 *
 * The whole group is stored as a single `{ optionId: boolean }` record under the
 * sub-block's OWN id — the same one-sub-block-one-store-key rule every other control
 * follows. Each option id is a tool param name; `expandSubBlockValueToParams` performs
 * that projection at the two boundaries where sub-block values become tool params.
 *
 * Writing each option id as its own top-level store key (what this did before) meant the
 * sub-block wrote keys the block never declared: the canvas serializer dropped all of
 * them, and inside an agent tool row the writes landed on the parent agent block instead
 * of the tool's own params.
 */
export function CheckboxList({
  blockId,
  subBlockId,
  options,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: CheckboxListProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<Record<string, boolean>>(blockId, subBlockId)

  const previewValue = isPreview && subBlockValues ? subBlockValues[subBlockId]?.value : undefined
  const selections = readSelections(isPreview ? previewValue : storeValue)

  const handleChange = useCallback(
    (optionId: string, checked: boolean) => {
      if (isPreview || disabled) return
      setStoreValue({ ...readSelections(storeValue), [optionId]: checked })
    },
    [storeValue, setStoreValue, isPreview, disabled]
  )

  return (
    <div className='flex flex-col gap-y-2.5 pt-1'>
      {options.map((option, index) => {
        // A `null`/absent entry means the user has never toggled this option, so the
        // declared default decides. An explicit `false` always wins over the default.
        const checked = selections[option.id] ?? option.defaultChecked ?? false
        const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
          activeSearchTarget,
          blockId,
          subBlockId,
          valuePath: ['options', index],
          label: option.label,
        })

        return (
          <div key={option.id} className='flex items-center gap-2'>
            <Checkbox
              id={`${blockId}-${subBlockId}-${option.id}`}
              checked={Boolean(checked)}
              onCheckedChange={(next) => handleChange(option.id, Boolean(next))}
              disabled={isPreview || disabled}
            />
            <Label
              htmlFor={`${blockId}-${subBlockId}-${option.id}`}
              className='cursor-pointer font-sans text-[var(--text-primary)] text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50'
            >
              {formatDisplayText(option.label, { workflowSearchHighlight })}
            </Label>
            {option.description && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <CircleInfo className='size-[14px] cursor-default text-[var(--text-muted)]' />
                </Tooltip.Trigger>
                <Tooltip.Content side='top' align='start' className='max-w-xs'>
                  <p>{option.description}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            )}
          </div>
        )
      })}
    </div>
  )
}
