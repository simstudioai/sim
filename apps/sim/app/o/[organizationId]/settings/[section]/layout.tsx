import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { resolveOrganizationSurfaceHeaderMeta } from '@/lib/organizations/settings-sections'

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
  if (!resolveOrganizationSurfaceHeaderMeta(section)) notFound()
  /** Every section draws its own heading in its surface. */
  return children
}
