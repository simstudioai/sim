'use client'

import { Switch as BaseSwitch } from '@base-ui/react/switch'
import styles from '@/platform/design-system/components/switch/switch.module.css'

interface SwitchProps {
  label: string
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export function Switch({ label, checked, defaultChecked, disabled, onCheckedChange }: SwitchProps) {
  return (
    <BaseSwitch.Root
      aria-label={label}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={styles.target}
    >
      <span className={styles.track}>
        <BaseSwitch.Thumb className={styles.thumb} />
      </span>
    </BaseSwitch.Root>
  )
}
