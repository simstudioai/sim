'use client'

import { TimePicker } from '@/components/emcn'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'

interface TimeInputProps {
  blockId: string
  subBlockId: string
  placeholder?: string
  isPreview?: boolean
  previewValue?: string | null
  className?: string
  disabled?: boolean
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
}: TimeInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)

  const value = isPreview ? previewValue : storeValue

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
    />
  )
}
