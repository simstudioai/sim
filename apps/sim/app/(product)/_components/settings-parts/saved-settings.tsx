'use client'

import type { ReactNode } from 'react'
import { IconButton } from '@sim/emcn/button'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { Tooltip } from '@sim/emcn/tooltip'
import styles from '@/app/(product)/_components/settings-parts/saved-settings.module.css'
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
  /** A clip of the behavior and the one line that explains it, both in the row's About tooltip. */
  preview?: {
    clip: 'auto-connect-on-drop' | 'auto-focus-on-click' | 'canvas-error-notification'
    caption: string
  }
}

/** A saved on-or-off preference. */
export function BooleanRow({ setting, label, preview }: BooleanRowProps) {
  const { checked, disabled, set } = useBooleanSetting(setting)
  return (
    <SettingsRow label={label}>
      {preview && (
        <Tooltip
          label={preview.caption}
          panel={
            <span className={styles.preview} data-material='floating' data-elevation='menu'>
              <span data-type='T060'>{preview.caption}</span>
              <video
                aria-label={`${label} example`}
                autoPlay
                muted
                playsInline
                loop={preview.clip !== 'canvas-error-notification'}
                src={`/tooltips/${preview.clip}.mp4`}
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
