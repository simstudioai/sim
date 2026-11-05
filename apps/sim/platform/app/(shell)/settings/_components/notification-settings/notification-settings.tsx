'use client'

import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { Switch } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'

export function NotificationSettings() {
  const settings = useInterfacePreferences()
  return (
    <SettingsSection title='Notifications'>
      <SettingsRow label='In-app notifications' description='When a run needs your attention'>
        <Switch
          label='In-app notifications'
          checked={settings?.inApp}
          onCheckedChange={settings?.setInApp}
        />
      </SettingsRow>
      <SettingsRow label='Play sound' description='Play a sound when work finishes'>
        <Switch label='Play sound' checked={settings?.sound} onCheckedChange={settings?.setSound} />
      </SettingsRow>
    </SettingsSection>
  )
}
