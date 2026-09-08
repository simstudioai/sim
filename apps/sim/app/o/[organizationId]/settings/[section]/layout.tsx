import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'
import {
  getSettingsSectionMeta,
  ORGANIZATION_SETTINGS_ITEMS,
  toSettingsHeaderMeta,
} from '@/components/settings/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { organizationRoutes } from '@/lib/navigation/paths'
import { resolveOrganizationSurfaceSection } from '@/app/o/[organizationId]/settings/navigation'

interface OrganizationSettingsSectionLayoutProps {
  children: ReactNode
  params: Promise<{ organizationId: string; section: string }>
}

export default async function OrganizationSettingsSectionLayout({
  children,
  params,
}: OrganizationSettingsSectionLayoutProps) {
  const { organizationId, section } = await params
  if (section === 'authorized-apps') {
    redirect(
      `${organizationRoutes(organizationId).settingsSection('general')}?view=authorized-apps`
    )
  }
  const resolved = resolveOrganizationSurfaceSection(section)
  const meta =
    resolved?.plane === 'organization'
      ? ORGANIZATION_SETTINGS_ITEMS.find(({ id }) => id === resolved.section)
      : resolved
        ? getSettingsSectionMeta('account', resolved.section)
        : null
  if (!meta) notFound()

  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell meta={toSettingsHeaderMeta(meta)}>{children}</SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
