'use client'

import { Switch as BaseSwitch } from '@base-ui/react/switch'
import styles from '@/platform/design-system/components/switch/switch.module.css'

interface SwitchProps {
  label: string
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export function Switch({ label, checked, defaultChecked, onCheckedChange }: SwitchProps) {
  return (
    <BaseSwitch.Root
      aria-label={label}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      className={styles.target}
    >
      <span className={styles.track}>
        <BaseSwitch.Thumb className={styles.thumb} />
      </span>
    </BaseSwitch.Root>
  )
}
