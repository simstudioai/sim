import 'server-only'
import { notFound } from 'next/navigation'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/**
 * The page gate, on the rule the navigation uses (`canBrowsePeople`), so a member withheld the
 * directory gets the same answer from a saved link as from the sidebar. `null` means the shell
 * layout has already answered a surface failure.
 */
export async function requirePeopleAccess(): Promise<PlatformOrganization | null> {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return null
  if (!surface.organization.navFlags.people) notFound()
  return surface.organization
}
