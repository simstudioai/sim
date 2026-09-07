import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { ORGANIZATION_SETTINGS_ITEMS, toSettingsHeaderMeta } from '@/components/settings/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { resolveOrganizationSettingsSection } from '@/app/o/[organizationId]/settings/navigation'

interface OrganizationSettingsSectionLayoutProps {
  children: ReactNode
  params: Promise<{ section: string }>
}

export default async function OrganizationSettingsSectionLayout({
  children,
  params,
}: OrganizationSettingsSectionLayoutProps) {
  const { section } = await params
  const resolved = resolveOrganizationSettingsSection(section)
  const item = ORGANIZATION_SETTINGS_ITEMS.find(({ id }) => id === resolved)
  if (!item) notFound()

  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell meta={toSettingsHeaderMeta(item)}>{children}</SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
