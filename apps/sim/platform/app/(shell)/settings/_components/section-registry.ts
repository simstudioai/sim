import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'

/** What a section receives. Its gate has already passed; its own API calls enforce the same rule. */
export interface SettingsSectionProps {
  organization: OrganizationSurfaceContext
  /** Segments after the section's key. */
  subpath: readonly string[]
  query: Record<string, string | string[] | undefined>
}
