'use client'

import { useId } from 'react'
import { Switch } from '@sim/emcn/switch'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/switch-input/switch-input.module.css'
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
  const id = useId()
  const [storeValue, setStoreValue] = useSubBlockValue<boolean | string>(blockId, subBlockId)
  const value = isPreview ? previewValue : (storeValue ?? propValue)
  return (
    <div className={styles.row} data-disabled={isPreview || disabled || undefined}>
      <Switch
        id={id}
        label={title}
        checked={value === true || value === 'true'}
        onCheckedChange={(checked) => {
          if (!isPreview && !disabled) setStoreValue(checked)
        }}
        disabled={isPreview || disabled}
      />
      <label htmlFor={id} className={styles.title} data-type='T060'>
        {title}
      </label>
    </div>
  )
}
