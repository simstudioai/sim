'use client'

import { Switch as BaseSwitch } from '@base-ui/react/switch'
import styles from '#emcn/components/switch/switch.module.css'

interface SwitchProps {
  /** Lets a visible caption name and toggle the switch through `<label htmlFor>`. */
  id?: string
  label: string
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export function Switch({
  id,
  label,
  checked,
  defaultChecked,
  disabled,
  onCheckedChange,
}: SwitchProps) {
  return (
    <BaseSwitch.Root
      id={id}
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
