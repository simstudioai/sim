import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  getOrganizationSettingsHref,
  ORGANIZATION_SETTINGS_ITEMS,
} from '@/components/settings/navigation'
import { getSession } from '@/lib/auth'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { OrganizationSettings } from '@/app/o/[organizationId]/settings/[section]/settings'
import { resolveOrganizationSettingsSection } from '@/app/o/[organizationId]/settings/navigation'

interface OrganizationSettingsSectionPageProps {
  params: Promise<{ organizationId: string; section: string }>
}

export async function generateMetadata({
  params,
}: OrganizationSettingsSectionPageProps): Promise<Metadata> {
  const { section } = await params
  const resolved = resolveOrganizationSettingsSection(section)
  return {
    title: ORGANIZATION_SETTINGS_ITEMS.find(({ id }) => id === resolved)?.label ?? 'Settings',
  }
}

export default async function OrganizationSettingsSectionPage({
  params,
}: OrganizationSettingsSectionPageProps) {
  const { organizationId, section } = await params
  const resolved = resolveOrganizationSettingsSection(section)
  if (!resolved) notFound()
  const session = await getSession()
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: getOrganizationSettingsHref(organizationId, resolved),
        isInviteFlow: false,
      })
    )
  }
  if (
    !(await authorizeOrganizationSettingsSection({
      organizationId,
      userId: session.user.id,
      section: resolved,
    }))
  ) {
    notFound()
  }
  return <OrganizationSettings section={resolved} />
}
