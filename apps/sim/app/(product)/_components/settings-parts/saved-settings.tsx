'use client'

import type { ReactNode } from 'react'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { useBooleanSetting, useSavedSettingsRead } from '@/platform/lib/data/preferences'

interface SavedSettingsSectionProps {
  title: string
  children: ReactNode
}

/** A section of saved preferences. They share one read, so a control never shows a guessed value. */
export function SavedSettingsSection({ title, children }: SavedSettingsSectionProps) {
  const { status, retry } = useSavedSettingsRead()
  if (status === 'pending') return <SettingsSection title={title} />
  if (status === 'error')
    return <FailureNotice message='Failed to load your settings' onRetry={retry} />
  return <SettingsSection title={title}>{children}</SettingsSection>
}

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
