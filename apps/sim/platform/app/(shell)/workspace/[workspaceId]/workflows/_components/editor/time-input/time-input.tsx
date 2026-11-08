'use client'

import { Input } from '@sim/emcn/field/inputs'
import { useSubBlockValue } from '@/platform/lib/data/workflow-editor'

interface TimeInputProps {
  blockId: string
  subBlockId: string
  /** Names the field for assistive technology. */
  label: string
  placeholder?: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

/** A time of day stored as 24-hour `HH:MM`, picked with the platform's time control. */
export function TimeInput({
  blockId,
  subBlockId,
  label,
  placeholder,
  isPreview = false,
  previewValue,
  disabled = false,
}: TimeInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const value = isPreview ? previewValue : storeValue
  return (
    <Input
      type='time'
      label={label}
      placeholder={placeholder || 'Select time'}
      value={typeof value === 'string' ? value : ''}
      disabled={isPreview || disabled}
      onChange={(next) => {
        if (!isPreview && !disabled) setStoreValue(next)
      }}
    />
  )
}
