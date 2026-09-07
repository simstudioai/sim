import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getOrganizationSettingsHref } from '@/components/settings/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { getSession } from '@/lib/auth'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { UsageEventsView } from '@/ee/organization-usage/components/usage-events-view'

export const metadata: Metadata = { title: 'Usage events' }

interface OrganizationUsageEventsPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function OrganizationUsageEventsPage({
  params,
}: OrganizationUsageEventsPageProps) {
  const { organizationId } = await params
  const backHref = getOrganizationSettingsHref(organizationId, 'usage')
  const session = await getSession()
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', { callbackUrl: `${backHref}/events`, isInviteFlow: false })
    )
  }
  if (
    !(await authorizeOrganizationSettingsSection({
      organizationId,
      userId: session.user.id,
      section: 'usage',
    }))
  ) {
    notFound()
  }

  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell>
        <UsageEventsView organizationId={organizationId} backHref={backHref} />
      </SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
