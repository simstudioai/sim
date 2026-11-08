'use client'

import { memo } from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/error-switch.module.css'

interface ErrorSwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled: boolean
}

/**
 * The legacy `Switch` at the card's error row (`scale-[0.72]`): the same Radix switch and paint,
 * so the On error toggle looks and behaves as it did.
 */
export const ErrorSwitch = memo(function ErrorSwitch({
  checked,
  onCheckedChange,
  disabled,
}: ErrorSwitchProps) {
  return (
    <SwitchPrimitives.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label='On error branch'
      disabled={disabled}
      className={styles.switch}
    >
      <SwitchPrimitives.Thumb className={styles.thumb} />
    </SwitchPrimitives.Root>
  )
})
