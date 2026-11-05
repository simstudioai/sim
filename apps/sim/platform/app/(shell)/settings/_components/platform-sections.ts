const PLATFORM_SETTINGS_SECTIONS = ['members', 'general', 'billing'] as const

/** A Settings section on the design. Every other section stays on its older page, beside a surface. */
export type PlatformSettingsSection = (typeof PLATFORM_SETTINGS_SECTIONS)[number]

export function isPlatformSettingsSection(section: string): section is PlatformSettingsSection {
  return (PLATFORM_SETTINGS_SECTIONS as readonly string[]).includes(section)
}
