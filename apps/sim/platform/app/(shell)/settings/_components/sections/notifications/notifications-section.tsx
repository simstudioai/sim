import { BooleanRow } from '@/platform/app/(shell)/settings/_components/boolean-row/boolean-row'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'

export default function NotificationsSection() {
  return (
    <SettingsSection title='Workflow editor'>
      <BooleanRow
        setting='errorNotificationsEnabled'
        label='Canvas error notifications'
        description='Show error popups on blocks when a workflow run fails'
      />
    </SettingsSection>
  )
}
