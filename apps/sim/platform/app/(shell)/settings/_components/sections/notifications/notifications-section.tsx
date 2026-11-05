'use client'

import { Switch } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { useBooleanSetting } from '@/platform/lib/data/preferences'

const LABEL = 'Canvas error notifications'

export default function NotificationsSection() {
  const { checked, disabled, set } = useBooleanSetting('errorNotificationsEnabled')
  return (
    <SettingsSection title='Workflow editor'>
      <SettingsRow
        label={LABEL}
        description='Show error popups on blocks when a workflow run fails'
      >
        <Switch label={LABEL} checked={checked} disabled={disabled} onCheckedChange={set} />
      </SettingsRow>
    </SettingsSection>
  )
}
