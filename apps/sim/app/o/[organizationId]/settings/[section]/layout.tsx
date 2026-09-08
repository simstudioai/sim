import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import {
  getSettingsSectionMeta,
  ORGANIZATION_SETTINGS_ITEMS,
  toSettingsHeaderMeta,
} from '@/components/settings/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { resolveOrganizationSurfaceSection } from '@/app/o/[organizationId]/settings/navigation'

interface OrganizationSettingsSectionLayoutProps {
  children: ReactNode
  params: Promise<{ section: string }>
}

export default async function OrganizationSettingsSectionLayout({
  children,
  params,
}: OrganizationSettingsSectionLayoutProps) {
  const { section } = await params
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
