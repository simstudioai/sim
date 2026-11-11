'use client'

import type { ReactNode } from 'react'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
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
    <SwitchRow
      label={label}
      description={description}
      checked={checked}
      disabled={disabled}
      onCheckedChange={set}
    />
  )
}
