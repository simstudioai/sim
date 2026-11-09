import { HydrationBoundary } from '@tanstack/react-query'
import { notFound } from 'next/navigation'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { FixtureSlackConnections } from '@/app/(product)/o/[organizationId]/settings/_components/sections/search-slack/fixture-slack-connections'
import { LiveSlackConnections } from '@/app/(product)/o/[organizationId]/settings/_components/sections/search-slack/live-slack-connections'
import { loadSlackSettings } from '@/platform/fixtures'
import { readSlackManifest } from '@/platform/lib/data/settings-slack'
import { readScenario } from '@/platform/lib/navigation'

export default async function SearchSlackSection({ organization, query }: SettingsSectionProps) {
  if (!organization.viewer.isAdmin) notFound()
  const fixture = await loadSlackSettings(readScenario(query.state))
  if (fixture)
    return (
      <FixtureSlackConnections
        initial={fixture.inventory}
        prospective={fixture.prospective}
        manifest={readSlackManifest(fixture.origin)}
        botManifests={Object.fromEntries(
          fixture.inventory.bots.map((bot) => [
            bot.id,
            readSlackManifest(fixture.origin, bot.displayName),
          ])
        )}
      />
    )
  const organizationId = organization.organization.id
  // Loaded only on live data: the reader imports the database, which fixture previews run without.
  const { prefetchSlackSearch } = await import('@/platform/lib/data/prefetch-slack-search')
  return (
    <HydrationBoundary state={await prefetchSlackSearch(organizationId)}>
      <LiveSlackConnections organizationId={organizationId} />
    </HydrationBoundary>
  )
}
