import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { keyboardShortcutGroups } from '@/platform/lib/data/keyboard-shortcuts'

export default function KeyboardShortcutsSection() {
  return keyboardShortcutGroups().map((group) => (
    <SettingsSection key={group.title} title={group.title}>
      {group.rows.map((row) => (
        <SettingsRow key={row.id} label={row.label}>
          <kbd data-type='T005'>{row.keys}</kbd>
        </SettingsRow>
      ))}
    </SettingsSection>
  ))
}
