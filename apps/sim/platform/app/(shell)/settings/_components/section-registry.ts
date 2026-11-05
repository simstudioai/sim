import type { PlatformOrganization } from '@/platform/lib/data/organization'

/** What a section receives. Its gate has already passed; its own API calls enforce the same rule. */
export interface SettingsSectionProps {
  organization: PlatformOrganization
  /** Segments after the section's key. */
  subpath: readonly string[]
  query: Record<string, string | string[] | undefined>
}
