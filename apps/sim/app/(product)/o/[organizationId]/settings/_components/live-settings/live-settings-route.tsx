import { notFound, redirect } from 'next/navigation'
import { SettingsLeaveGuard } from '@/app/(product)/_components/session-state/settings-leave-guard'
import { SETTINGS_SECTIONS } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { SettingsScreen } from '@/app/(product)/o/[organizationId]/settings/_components/settings-screen/settings-screen'
import { resolveLegacyRequestLink } from '@/platform/lib/data/legacy-request-link'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { resolveLiveSetting } from '@/platform/lib/data/settings-navigation'

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
  const aliases: Record<string, string> = {
    preferences: 'general',
    account: 'general',
    'authorized-apps': 'general',
    privacy: 'general',
    notifications: 'general',
    connections: 'connected-accounts',
    organization: 'members',
    team: 'members',
    subscription: 'billing',
    domains: 'sso',
    sessions: 'security',
  }
  if (!subpath.length && Object.hasOwn(aliases, key)) {
    const params = new URLSearchParams()
    for (const [name, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
        params.append(name, item)
    }
    if (key === 'privacy' || key === 'authorized-apps') params.set('view', key)
    redirect(`/settings/${aliases[key]}${params.size ? `?${params}` : ''}`)
  }
  const requestLink = !subpath.length && resolveLegacyRequestLink(key, query)
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
  const { default: Section } = await entry.load()
  return (
    <SettingsScreen title={setting.title}>
      {fixture && <SettingsLeaveGuard />}
      <Section fixture={fixture} organization={organization} subpath={subpath} query={query} />
    </SettingsScreen>
  )
}
