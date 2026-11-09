import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'

export default function KeyboardShortcutsSection() {
  return (
    <SettingsSection title='Navigation'>
      <SettingsRow label='Search'>
        <kbd data-type='T005'>⌘ / Ctrl + K</kbd>
      </SettingsRow>
      <SettingsRow label='Search settings'>
        <kbd data-type='T005'>/</kbd>
      </SettingsRow>
      <SettingsRow label='Close menu or dialog'>
        <kbd data-type='T005'>Esc</kbd>
      </SettingsRow>
    </SettingsSection>
  )
}
