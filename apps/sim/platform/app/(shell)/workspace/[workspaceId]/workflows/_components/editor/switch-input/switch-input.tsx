'use client'

import { SwitchField } from '@sim/emcn/field'
import { useSubBlockValue } from '@/platform/lib/data/workflow-editor'

interface SwitchInputProps {
  blockId: string
  subBlockId: string
  title: string
  /** The block's default when nothing is stored yet. */
  value?: boolean | string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

/** A boolean sub-block: a switch beside its title, which takes effect at once. */
export function SwitchInput({
  blockId,
  subBlockId,
  title,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled = false,
}: SwitchInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<boolean | string>(blockId, subBlockId)
  const value = isPreview ? previewValue : (storeValue ?? propValue)
  return (
    <SwitchField
      label={title}
      checked={value === true || value === 'true'}
      disabled={isPreview || disabled}
      onCheckedChange={(checked) => {
        if (!isPreview && !disabled) setStoreValue(checked)
      }}
    />
  )
}
