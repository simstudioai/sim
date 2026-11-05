'use client'

import { Switch } from '@/platform/design-system/components'
import { SettingsRow } from '@/platform/design-system/components/settings-section/settings-section'
import { useBooleanSetting } from '@/platform/lib/data/preferences'

interface BooleanRowProps {
  setting: Parameters<typeof useBooleanSetting>[0]
  label: string
  description: string
}

/** A saved on-or-off preference. */
export function BooleanRow({ setting, label, description }: BooleanRowProps) {
  const { checked, disabled, set } = useBooleanSetting(setting)
  return (
    <SettingsRow label={label} description={description}>
      <Switch label={label} checked={checked} disabled={disabled} onCheckedChange={set} />
    </SettingsRow>
  )
}
