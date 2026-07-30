import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  getOrganizationSettingsFeatures,
  getSettingsSectionMeta,
  isOrganizationSettingsSectionAvailable,
  ORGANIZATION_SETTINGS_ITEMS,
  ORGANIZATION_SETTINGS_PATH_ALIASES,
  parseSettingsPathSection,
} from '@/components/settings/navigation'
import { OrganizationSettingsRenderer } from '@/components/settings/organization-settings-renderer'
import { SettingsUnavailable } from '@/components/settings/settings-unavailable'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import { canOpenOrganizationSettingsSection } from '@/lib/organizations/settings-access'

interface OrganizationSettingsSectionPageProps {
  params: Promise<{ organizationId: string; section: string }>
}

export async function generateMetadata({
  params,
}: OrganizationSettingsSectionPageProps): Promise<Metadata> {
  const { section } = await params
  const parsed = parseSettingsPathSection({
    path: section,
    items: ORGANIZATION_SETTINGS_ITEMS,
    defaultSection: null,
    aliases: ORGANIZATION_SETTINGS_PATH_ALIASES,
  })
  const meta = parsed ? getSettingsSectionMeta('organization', parsed) : null
  return { title: meta ? `${meta.label} - Organization settings` : 'Organization settings' }
}

export default async function OrganizationSettingsSectionPage({
  params,
}: OrganizationSettingsSectionPageProps) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { organizationId, section } = await params
  const parsed = parseSettingsPathSection({
    path: section,
    items: ORGANIZATION_SETTINGS_ITEMS,
    defaultSection: null,
    aliases: ORGANIZATION_SETTINGS_PATH_ALIASES,
  })
  if (!parsed) notFound()

  const canOpen = await canOpenOrganizationSettingsSection(organizationId, session.user.id, parsed)
  if (!canOpen) return <SettingsUnavailable embedded />
  const hasEnterprisePlan =
    parsed !== 'members' &&
    parsed !== 'billing' &&
    (await isOrganizationOnEnterprisePlan(organizationId))
  if (
    !isOrganizationSettingsSectionAvailable(
      parsed,
      getOrganizationSettingsFeatures(hasEnterprisePlan)
    )
  ) {
    return (
      <SettingsUnavailable
        embedded
        title='Setting unavailable'
        description='This setting is not enabled for this organization.'
      />
    )
  }

  return <OrganizationSettingsRenderer organizationId={organizationId} section={parsed} />
}
