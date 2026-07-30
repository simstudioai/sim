import { redirect } from 'next/navigation'
import { SettingsUnavailable } from '@/components/settings/settings-unavailable'
import { StandaloneSettingsShell } from '@/components/settings/standalone-settings-shell'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import { getOrganizationSettingsAccess } from '@/lib/organizations/settings-access'

interface OrganizationSettingsLayoutProps {
  children: React.ReactNode
  params: Promise<{ organizationId: string }>
}

export default async function OrganizationSettingsLayout({
  children,
  params,
}: OrganizationSettingsLayoutProps) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { organizationId } = await params
  const access = await getOrganizationSettingsAccess(organizationId, session.user.id)
  if (!access.isMember) return <SettingsUnavailable />
  const hasEnterprisePlan = access.isAdmin && (await isOrganizationOnEnterprisePlan(organizationId))

  return (
    <StandaloneSettingsShell
      plane='organization'
      organizationId={organizationId}
      hasEnterprisePlan={hasEnterprisePlan}
      isOrganizationAdmin={access.isAdmin}
    >
      {children}
    </StandaloneSettingsShell>
  )
}
