import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

interface SettingsDestination {
  key: string
  title: string
  icon: IconName
}

export const SETTINGS_DESTINATIONS = [
  { key: 'preferences', title: 'Preferences', icon: 'I116' },
  { key: 'keyboard-shortcuts', title: 'Keyboard shortcuts', icon: 'I044' },
  { key: 'notifications', title: 'Notifications', icon: 'I106' },
  { key: 'connections', title: 'Connections', icon: 'I070' },
  { key: 'members', title: 'Members', icon: 'I104' },
] as const satisfies readonly SettingsDestination[]
