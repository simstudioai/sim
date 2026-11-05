const PLATFORM_SETTINGS_SECTIONS = [
  'general',
  'billing',
  'knowledge-graphs',
  'members',
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
  'search-mcp',
] as const

/** A Settings section on the design. Every other section stays on its older page, beside a surface. */
export type PlatformSettingsSection = (typeof PLATFORM_SETTINGS_SECTIONS)[number]

export function isPlatformSettingsSection(section: string): section is PlatformSettingsSection {
  return (PLATFORM_SETTINGS_SECTIONS as readonly string[]).includes(section)
}
