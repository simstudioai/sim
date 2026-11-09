import { notFound } from 'next/navigation'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { SlackConnections } from '@/app/(product)/o/[organizationId]/settings/_components/sections/search-slack/slack-connections'
import { loadSlackSettings } from '@/platform/fixtures'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import { readSlackManifest, type SlackSearchList } from '@/platform/lib/data/settings-slack'
import { readScenario } from '@/platform/lib/navigation'

/** Loaded on demand: the live reader imports the database, which fixture previews run without. */
async function readLiveInventory(organizationId: string): Promise<SlackSearchList | null> {
  const { readSlackConnections } = await import('@/platform/lib/data/slack-connections')
  return readSlackConnections(organizationId).catch(() => null)
}

export default async function SearchSlackSection({ organization, query }: SettingsSectionProps) {
  if (!organization.viewer.isAdmin) notFound()
  const fixture = await loadSlackSettings(readScenario(query.state))
  const inventory = fixture?.inventory ?? (await readLiveInventory(organization.organization.id))
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
