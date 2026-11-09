import { notFound } from 'next/navigation'
import { matchPathPattern } from '@/lib/navigation/paths'
import {
  isClientSettingsSection,
  SETTINGS_SECTIONS,
} from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { SettingsScreen } from '@/app/(product)/o/[organizationId]/settings/_components/settings-screen/settings-screen'
import { OrganizationSettingsSection } from '@/app/(product)/o/[organizationId]/settings/_components/settings-section/settings-section'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { resolveLiveSetting } from '@/platform/lib/data/settings-navigation'

interface LiveSettingsRouteProps {
  organization: PlatformOrganization
  fixture?: true
  path: readonly string[]
  query: Record<string, string | string[] | undefined>
}

/** The section a Settings path names, once the page has answered any surface failure or redirect. */
export function LiveSettingsRoute({ path, query, organization, fixture }: LiveSettingsRouteProps) {
  const [key = 'general', ...subpath] = path
  const setting = resolveLiveSetting(key, organization)
  if (!setting) notFound()
  const entry = SETTINGS_SECTIONS[setting.key]
  if (subpath.length && !entry.subpaths?.some((pattern) => matchPathPattern(pattern, subpath)))
    notFound()
  const { Section } = entry
  return (
    <SettingsScreen title={setting.title}>
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
