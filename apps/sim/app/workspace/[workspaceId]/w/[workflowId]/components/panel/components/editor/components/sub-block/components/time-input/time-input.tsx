'use client'

import { TimePicker } from '@/components/emcn'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { ActiveSearchTarget } from '@/stores/panel/editor/store'

interface TimeInputProps {
  blockId: string
  subBlockId: string
  placeholder?: string
  isPreview?: boolean
  previewValue?: string | null
  className?: string
  disabled?: boolean
  activeSearchTarget?: ActiveSearchTarget | null
}

function formatTimeInputDisplayLabel(value: string): string {
  const [hours, minutes] = value.split(':')
  const hour = Number.parseInt(hours ?? '', 10)
  if (!Number.isFinite(hour) || !minutes) return value
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minutes} ${ampm}`
}

/**
 * Time input wrapper for sub-block editor.
 * Connects the EMCN TimePicker to the sub-block store.
 */
export function TimeInput({
  blockId,
  subBlockId,
  placeholder,
  isPreview = false,
  previewValue,
  className,
  disabled = false,
  activeSearchTarget,
}: TimeInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)

  const value = isPreview ? previewValue : storeValue
  const displayLabel = value ? formatTimeInputDisplayLabel(value) : ''
  const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
    activeSearchTarget,
    blockId,
    subBlockId,
    valuePath: [],
    label: displayLabel,
  })

  const handleChange = (newValue: string) => {
    if (isPreview || disabled) return
    setStoreValue(newValue)
  }

  return (
    <TimePicker
      value={value || undefined}
      onChange={handleChange}
      placeholder={placeholder || 'Select time'}
      disabled={isPreview || disabled}
      className={className}
      overlayContent={
        workflowSearchHighlight ? (
          <span className='truncate'>
            {formatDisplayText(displayLabel, { workflowSearchHighlight })}
          </span>
        ) : undefined
      }
    />
  )
}
