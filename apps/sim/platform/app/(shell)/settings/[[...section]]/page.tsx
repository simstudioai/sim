import { notFound } from 'next/navigation'
import { ProductFrame, readScenario } from '@/platform/app/(shell)/_components/product-frame'
import { SETTINGS_DESTINATIONS } from '@/platform/app/(shell)/settings/_components/settings-navigation/destinations'
import { SettingsNavigation } from '@/platform/app/(shell)/settings/_components/settings-navigation/settings-navigation'
import { SettingsScreen } from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen'
import { loadSettingsData, loadShellData } from '@/platform/fixtures'

export default async function Page({
  searchParams,
  params,
}: PageProps<'/settings/[[...section]]'>) {
  const [query, { section: path }] = await Promise.all([searchParams, params])
  const section = path?.[0] ?? 'preferences'
  const destination = SETTINGS_DESTINATIONS.find((item) => item.key === section)
  if ((path && path.length !== 1) || !destination) notFound()
  const scenario = readScenario(query)
  const [data, shell] = await Promise.all([loadSettingsData(scenario), loadShellData(scenario)])
  return (
    <ProductFrame
      desktopTitle={`Settings / ${destination.title}`}
      query={query}
      shell={shell}
      navigation={<SettingsNavigation section={section} organization={shell?.organization.name} />}
    >
      <SettingsScreen profileName={shell?.user.name} section={section} data={data} />
    </ProductFrame>
  )
}
