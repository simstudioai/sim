import { redirect } from 'next/navigation'
import { getOrganizationSettingsHref } from '@/components/settings/navigation'

interface OrganizationSettingsPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function OrganizationSettingsPage({ params }: OrganizationSettingsPageProps) {
  const { organizationId } = await params
  redirect(getOrganizationSettingsHref(organizationId, 'members'))
}
