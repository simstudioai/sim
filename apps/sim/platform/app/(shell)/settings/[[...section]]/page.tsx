import { notFound } from 'next/navigation'
import { SETTINGS_DESTINATIONS } from '@/platform/app/(shell)/_components/settings-navigation/destinations'
import { SettingsScreen } from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen'
import { readScenario } from '@/platform/design-system/navigation'
import { loadSettingsData, loadShellData } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export default async function Page({
  searchParams,
  params,
}: PageProps<'/settings/[[...section]]'>) {
  const [query, { section: path }] = await Promise.all([searchParams, params])
  if (resolvePlatformMode() === 'live') {
    const { LiveSettingsRoute } = await import(
      '@/platform/app/(shell)/settings/_components/live-settings/live-settings-route'
    )
    return <LiveSettingsRoute path={path ?? []} query={query} />
  }
  const section = path?.[0] ?? 'preferences'
  const destination = SETTINGS_DESTINATIONS.find((item) => item.key === section)
  if ((path && path.length !== 1) || !destination) notFound()
  const scenario = readScenario(query.state)
  const [data, shell] = await Promise.all([loadSettingsData(scenario), loadShellData(scenario)])
  return <SettingsScreen profileName={shell?.user.name} section={section} data={data} />
}
