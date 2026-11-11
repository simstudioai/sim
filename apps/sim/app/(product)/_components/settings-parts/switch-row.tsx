'use client'

import { SettingsRow } from '@sim/emcn/settings-section'
import { Switch } from '@sim/emcn/switch'

interface SwitchRowProps {
  label: string
  /** A concise line in Paper's voice: sentence case, second person, no closing period. */
  description: string
  checked: boolean
  /** Also set while the switch's own write is pending, so it cannot be toggled twice. */
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}

/** A settings row that turns one thing on or off, named by its label. */
export function SwitchRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: SwitchRowProps) {
  return (
    <SettingsRow label={label} description={description}>
      <Switch
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </SettingsRow>
  )
}
