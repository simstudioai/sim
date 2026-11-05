const PLATFORM_SETTINGS_SECTIONS = [
  'general',
  'billing',
  'knowledge-graphs',
  'members',
  'connected-accounts',
  'usage',
  'whitelabeling',
  'recently-deleted',
  'requests',
  'audit-logs',
  'access-control',
  'sso',
  'security',
  'data-retention',
  'data-drains',
  'integrations',
  'search-mcp',
  'search-slack',
] as const

/** A section the organization view's Settings renders. */
export type PlatformSettingsSection = (typeof PLATFORM_SETTINGS_SECTIONS)[number]

export function isPlatformSettingsSection(section: string): section is PlatformSettingsSection {
  return (PLATFORM_SETTINGS_SECTIONS as readonly string[]).includes(section)
}
