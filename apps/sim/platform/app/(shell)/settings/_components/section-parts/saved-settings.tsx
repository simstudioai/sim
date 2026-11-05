'use client'

import type { ReactNode } from 'react'
import { SectionSkeleton } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { FailureNotice, Switch } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { useBooleanSetting, useSavedSettingsRead } from '@/platform/lib/data/preferences'

interface SavedSettingsSectionProps {
  title: string
  rows?: number
  children: ReactNode
}

/** A section of saved preferences. They share one read, so a control never shows a guessed value. */
export function SavedSettingsSection({ title, rows, children }: SavedSettingsSectionProps) {
  const { status, retry } = useSavedSettingsRead()
  if (status === 'pending') return <SectionSkeleton title={title} rows={rows} />
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
