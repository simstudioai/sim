import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  resolveOrganizationSurfaceHeaderMeta,
  resolveOrganizationSurfaceSection,
} from '@/app/o/[organizationId]/settings/navigation'
import { isPlatformSettingsSection } from '@/platform/app/(shell)/settings/_components/platform-sections'

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
  const meta = resolveOrganizationSurfaceHeaderMeta(section)
  if (!meta) notFound()
  const resolved = resolveOrganizationSurfaceSection(section)
  /** A section on the design draws its own heading in its surface. */
  if (resolved && isPlatformSettingsSection(resolved.section)) return children

  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell meta={meta}>{children}</SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
