import { notFound } from 'next/navigation'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { SlackConnections } from '@/platform/app/(shell)/settings/_components/sections/search-slack/slack-connections'
import { loadSlackSettings } from '@/platform/fixtures'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import { readSlackConnections, readSlackManifest } from '@/platform/lib/data/settings-slack'
import { readScenario } from '@/platform/lib/navigation'

export default async function SearchSlackSection({ organization, query }: SettingsSectionProps) {
  if (!organization.viewer.isAdmin) notFound()
  const fixture = await loadSlackSettings(readScenario(query.state))
  const inventory =
    fixture?.inventory ??
    (await readSlackConnections(organization.organization.id).catch(() => null))
  const origin = fixture?.origin ?? organization.legacyOrigin
  return (
    <SlackConnections
      initial={inventory}
      prospective={fixture?.prospective}
      manageHref={legacyRoutes(organization).settingsSection('search-slack')}
      manifest={readSlackManifest(origin)}
      botManifests={Object.fromEntries(
        (inventory?.bots ?? []).map((bot) => [bot.id, readSlackManifest(origin, bot.displayName)])
      )}
    />
  )
}
