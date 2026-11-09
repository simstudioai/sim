import { notFound } from 'next/navigation'
import { matchPathPattern } from '@/lib/navigation/paths'
import { SettingsLeaveGuard } from '@/app/(product)/_components/session-state/settings-leave-guard'
import {
  isClientSettingsSection,
  SETTINGS_SECTIONS,
} from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { SettingsScreen } from '@/app/(product)/o/[organizationId]/settings/_components/settings-screen/settings-screen'
import { OrganizationSettingsSection } from '@/app/(product)/o/[organizationId]/settings/_components/settings-section/settings-section'
import { type PlatformOrganization, surfaceHref } from '@/platform/lib/data/organization-model'
import { resolveLiveSetting } from '@/platform/lib/data/settings-navigation'

interface LiveSettingsRouteProps {
  organization: PlatformOrganization
  fixture?: true
  path: readonly string[]
  query: Record<string, string | string[] | undefined>
}

/**
 * The shell layout has already answered any surface failure. A live session first follows the
 * route table, which owns Settings aliases and saved access-request links.
 */
export async function LiveSettingsRoute({
  path,
  query,
  organization,
  fixture,
}: LiveSettingsRouteProps) {
  if (!fixture) {
    const { followProductRoute, productLocation } = await import(
      '@/platform/lib/data/route-resolution'
    )
    const pathname = surfaceHref(
      organization,
      ['/settings', ...path.map(encodeURIComponent)].join('/')
    )
    await followProductRoute(organization, productLocation(pathname, query))
  }
  const [key = 'general', ...subpath] = path
  const setting = resolveLiveSetting(key, organization)
  if (!setting) notFound()
  const entry = SETTINGS_SECTIONS[setting.key]
  if (subpath.length && !entry.subpaths?.some((pattern) => matchPathPattern(pattern, subpath)))
    notFound()
  const { Section } = entry
  return (
    <SettingsScreen title={setting.title}>
      {fixture && <SettingsLeaveGuard />}
      {isClientSettingsSection(setting.key) ? (
        <OrganizationSettingsSection
          section={setting.key}
          fixture={fixture}
          organization={organization}
          subpath={subpath}
          query={query}
        />
      ) : (
        Section && (
          <Section fixture={fixture} organization={organization} subpath={subpath} query={query} />
        )
      )}
    </SettingsScreen>
  )
}
