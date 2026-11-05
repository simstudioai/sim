import {
  BooleanRow,
  SavedSettingsSection,
} from '@/platform/app/(shell)/settings/_components/section-parts/saved-settings'

export default function NotificationsSection() {
  return (
    <SavedSettingsSection title='Workflow editor' rows={1}>
      <BooleanRow
        setting='errorNotificationsEnabled'
        label='Canvas error notifications'
        description='Show error popups on blocks when a workflow run fails'
      />
    </SavedSettingsSection>
  )
}
