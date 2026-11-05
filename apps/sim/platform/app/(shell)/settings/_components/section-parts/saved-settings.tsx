'use client'

import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/settings/_components/section-parts/saved-settings.module.css'
import { SectionSkeleton } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { FailureNotice, IconButton, Switch, Tooltip } from '@/platform/design-system/components'
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
  preview?: 'auto-connect-on-drop' | 'auto-focus-on-click' | 'canvas-error-notification'
}

/** A saved on-or-off preference. */
export function BooleanRow({ setting, label, description, preview }: BooleanRowProps) {
  const { checked, disabled, set } = useBooleanSetting(setting)
  return (
    <SettingsRow label={label} description={description}>
      {preview && (
        <Tooltip
          label={description}
          panel={
            <span className={styles.preview} data-material='floating' data-elevation='menu'>
              <span data-type='T060'>{description}</span>
              <video
                aria-label={`${label} example`}
                autoPlay
                muted
                playsInline
                loop={preview !== 'canvas-error-notification'}
                src={`/tooltips/${preview}.mp4`}
              />
            </span>
          }
        >
          <IconButton icon='I047' label={`About ${label.toLowerCase()}`} size='compact' />
        </Tooltip>
      )}
      <Switch label={label} checked={checked} disabled={disabled} onCheckedChange={set} />
    </SettingsRow>
  )
}
