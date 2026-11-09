import { notFound, redirect } from 'next/navigation'
import { SettingsLeaveGuard } from '@/app/(product)/_components/session-state/settings-leave-guard'
import {
  isClientSettingsSection,
  SETTINGS_SECTIONS,
} from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { SettingsScreen } from '@/app/(product)/o/[organizationId]/settings/_components/settings-screen/settings-screen'
import { OrganizationSettingsSection } from '@/app/(product)/o/[organizationId]/settings/_components/settings-section/settings-section'
import { resolveLegacyRequestLink } from '@/platform/lib/data/legacy-request-link'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { resolveLiveSetting, resolveSettingsAlias } from '@/platform/lib/data/settings-navigation'

interface LiveSettingsRouteProps {
  organization: PlatformOrganization
  fixture?: true
  path: readonly string[]
  query: Record<string, string | string[] | undefined>
}

/** The shell layout has already answered any surface failure. */
export async function LiveSettingsRoute({
  path,
  query,
  organization,
  fixture,
}: LiveSettingsRouteProps) {
  const [key = 'general', ...subpath] = path
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      params.append(name, item)
  }
  const alias = resolveSettingsAlias(organization, path, params)
  if (alias) redirect(alias)
  const requestLink = !subpath.length && resolveLegacyRequestLink(organization, key, query)
  if (requestLink) {
    if (!resolveLiveSetting('requests', organization)) notFound()
    redirect(requestLink)
  }
  const setting = resolveLiveSetting(key, organization)
  if (!setting) notFound()
  const entry = SETTINGS_SECTIONS[setting.key]
  if (
    subpath.length &&
    !entry.subpaths?.some((pattern) => {
      const segments = pattern.split('/')
      return (
        segments.length === subpath.length &&
        segments.every((value, index) => value.startsWith(':') || value === subpath[index])
      )
    })
  )
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
