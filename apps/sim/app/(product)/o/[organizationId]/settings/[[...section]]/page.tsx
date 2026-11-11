import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { decodePathSegments } from '@/lib/navigation/paths'
import { SettingsLeaveGuard } from '@/app/(product)/_components/session-state/settings-leave-guard'
import { LiveSettingsRoute } from '@/app/(product)/o/[organizationId]/settings/_components/live-settings/live-settings-route'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { settingsPageTitle } from '@/platform/lib/data/settings-navigation'
import { readPreviewPlan, readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'

export async function generateMetadata({
  params,
}: ProductPageProps<{ organizationId: string; section?: string[] }>): Promise<Metadata> {
  const { section = [] } = await params
  return { title: settingsPageTitle(section) }
}

export default async function Page({
  searchParams,
  params,
}: ProductPageProps<{ organizationId: string; section?: string[] }>) {
  const [query, { section: encodedPath = [] }] = await Promise.all([searchParams, params])
  const path = decodePathSegments(encodedPath)
  if (!path) notFound()
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const { loadSettingsFixture } = await import('@/platform/fixtures')
    const fixture = await loadSettingsFixture(
      readScenario(query.state),
      readPreviewPlan(query.plan)
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
        <SettingsLeaveGuard />
        <LiveSettingsRoute fixture organization={organization} path={path} query={query} />
      </Provider>
    )
  }
  const { readOrganizationSurface } = await import('@/platform/lib/data/surface')
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return null
  const { followProductRoute, productLocation } = await import(
    '@/platform/lib/data/route-resolution'
  )
  const pathname = surfaceHref(
    surface.organization,
    ['/settings', ...path.map(encodeURIComponent)].join('/')
  )
  await followProductRoute(surface.organization, productLocation(pathname, query))
  const { prefetchSettingsSection } = await import('@/platform/lib/data/prefetch-settings')
  return (
    <LiveSettingsRoute
      organization={surface.organization}
      path={path}
      query={query}
      firstPaint={await prefetchSettingsSection(path, surface.organization)}
    />
  )
}
