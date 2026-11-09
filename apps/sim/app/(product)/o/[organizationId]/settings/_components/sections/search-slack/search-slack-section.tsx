import { HydrationBoundary } from '@tanstack/react-query'
import { notFound } from 'next/navigation'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { LiveSlackConnections } from '@/app/(product)/o/[organizationId]/settings/_components/sections/search-slack/live-slack-connections'
import { readSlackManifest } from '@/platform/lib/data/settings-slack'
import { readScenario } from '@/platform/lib/navigation'

export default async function SearchSlackSection({ organization, query }: SettingsSectionProps) {
  if (!organization.viewer.isAdmin) notFound()
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const [{ FixtureSlackConnections }, { loadSlackSettings }] = await Promise.all([
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/search-slack/fixture-slack-connections'
      ),
      import('@/platform/fixtures'),
    ])
    const fixture = await loadSlackSettings(readScenario(query.state))
    if (!fixture) notFound()
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
  }
  const organizationId = organization.organization.id
  // Loaded only on live data: the reader imports the database, which fixture previews run without.
  const { prefetchSlackSearch } = await import('@/platform/lib/data/prefetch-slack-search')
  return (
    <HydrationBoundary state={await prefetchSlackSearch(organizationId)}>
      <LiveSlackConnections organizationId={organizationId} />
    </HydrationBoundary>
  )
}
