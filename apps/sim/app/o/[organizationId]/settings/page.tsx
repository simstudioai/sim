import { redirect } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'

interface OrganizationSettingsPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function OrganizationSettingsPage({ params }: OrganizationSettingsPageProps) {
  const { organizationId } = await params
  redirect(organizationRoutes(organizationId).settingsSection('general'))
}
