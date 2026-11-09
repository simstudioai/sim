import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { isUpgradeReason, UPGRADE_REASON_PARAM } from '@/lib/billing/upgrade-reasons'
import { organizationRoutes } from '@/lib/navigation/paths'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'

/**
 * Public upgrade entry, for callers that cannot know an organization — a self-hosted deployment
 * linking its users to the hosted plans, or an email. Plans belong to the organization's billing,
 * so a member lands on the plans of the organization `/o` would open. A viewer in no organization
 * yet goes through `/workspace`, which owns first-workspace creation and carries the reason on.
 */
export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [session, params] = await Promise.all([getSession(), searchParams])

  const rawReason = params[UPGRADE_REASON_PARAM]
  const reasonValue = Array.isArray(rawReason) ? rawReason[0] : rawReason
  const reason = isUpgradeReason(reasonValue) ? reasonValue : undefined
  const reasonQuery = reason ? `${UPGRADE_REASON_PARAM}=${reason}` : ''

  if (!session?.user) {
    const callbackUrl = reasonQuery ? `/upgrade?${reasonQuery}` : '/upgrade'
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }

  const organizationId = await resolveOrganizationLanding(
    session.user.id,
    getActiveOrganizationId(session)
  )
  if (!organizationId) {
    redirect(`/workspace?redirect=upgrade${reasonQuery ? `&${reasonQuery}` : ''}`)
  }

  const plans = organizationRoutes(organizationId).settingsSection('billing/plans')
  redirect(reasonQuery ? `${plans}?${reasonQuery}` : plans)
}
