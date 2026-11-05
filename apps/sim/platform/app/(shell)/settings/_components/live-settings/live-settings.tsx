import { notFound } from 'next/navigation'
import { resolveLiveSetting } from '@/platform/app/(shell)/_components/settings-navigation/destinations'
import { SETTINGS_SECTIONS } from '@/platform/app/(shell)/settings/_components/section-registry'
import { SettingsScreen } from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

interface LiveSettingsProps {
  path: readonly string[]
  query: Record<string, string | string[] | undefined>
}

/** The shell layout has already answered any surface failure. */
export async function LiveSettings({ path, query }: LiveSettingsProps) {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return null
  const { organization } = surface
  const [key = 'preferences', ...subpath] = path
  const setting = resolveLiveSetting(key, organization)
  if (!setting) notFound()
  const entry = SETTINGS_SECTIONS[setting.key]
  if (subpath.length && !entry.subpaths?.includes(subpath.join('/'))) notFound()
  const { default: Section } = await entry.load()
  return (
    <SettingsScreen section={setting.key} title={setting.title} data={null}>
      <Section organization={organization} subpath={subpath} query={query} />
    </SettingsScreen>
  )
}
