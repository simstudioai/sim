import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { isUpgradeReason, UPGRADE_REASON_PARAM } from '@/lib/billing/upgrade-reasons'

/**
 * Public upgrade entry, for callers that cannot know a workspace id — a
 * self-hosted deployment linking its users to the hosted plans, or an email
 * that predates a workspace switch.
 *
 * Workspace resolution is not repeated here: `/workspace` already owns it,
 * including local recency, last-active fallback, stale-session recovery, and
 * the no-workspace creation policy.
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

  const target = reason
    ? `/workspace?redirect=upgrade&${UPGRADE_REASON_PARAM}=${reason}`
    : '/workspace?redirect=upgrade'

  // `/workspace` recovers a signed-out visitor by hard-navigating to `/login`
  // with no callback, which would drop the upgrade intent — carry it here
  // instead, where the destination is still known.
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(target)}`)
  }

  redirect(target)
}
