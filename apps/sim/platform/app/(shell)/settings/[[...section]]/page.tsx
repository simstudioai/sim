import { EmptyState } from '@sim/emcn/empty-state'
import { LiveSettingsRoute } from '@/platform/app/(shell)/settings/_components/live-settings/live-settings-route'
import { SettingsScreen } from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen'
import { loadSettingsFixture } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { readPreviewPlan, readScenario } from '@/platform/lib/navigation'

export default async function Page({
  searchParams,
  params,
}: PageProps<'/settings/[[...section]]'>) {
  const [query, { section: path = [] }] = await Promise.all([searchParams, params])
  if (resolvePlatformMode() === 'live') {
    const { readOrganizationSurface } = await import('@/platform/lib/data/surface')
    const surface = await readOrganizationSurface()
    return surface.status === 'ok' ? (
      <LiveSettingsRoute organization={surface.organization} path={path} query={query} />
    ) : null
  }
  const fixture = await loadSettingsFixture(readScenario(query.state), readPreviewPlan(query.plan))
  if (!fixture)
    return (
      <SettingsScreen title='Settings'>
        <EmptyState title='No organization selected' />
      </SettingsScreen>
    )
  const { Provider, organization, scenario, profile, referenceTime, plan } = fixture
  return (
    <Provider
      organization={organization}
      scenario={scenario}
      plan={plan}
      profile={profile}
      referenceTime={referenceTime}
    >
      <LiveSettingsRoute fixture organization={organization} path={path} query={query} />
    </Provider>
  )
}
