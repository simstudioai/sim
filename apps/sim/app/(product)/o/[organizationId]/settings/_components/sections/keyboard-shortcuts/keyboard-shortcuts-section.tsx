import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { headers } from 'next/headers'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import { keyboardShortcutGroups } from '@/platform/lib/data/keyboard-shortcuts'

/**
 * Every shortcut, with the keys of the platform the request came from. A shortcut row has no
 * description, unlike other settings rows: its label names the action and its keys are its value, so
 * a second line would only restate the label.
 */
export default async function KeyboardShortcutsSection() {
  const userAgent = (await headers()).get('user-agent') ?? ''
  return (
    <>
      <SettingsPageHeader />
      {keyboardShortcutGroups(userAgent).map((group) => (
        <SettingsSection key={group.title} title={group.title}>
          {group.rows.map((row) => (
            <SettingsRow key={row.id} label={row.label}>
              <kbd data-type='T005'>{row.keys}</kbd>
            </SettingsRow>
          ))}
        </SettingsSection>
      ))}
    </>
  )
}
