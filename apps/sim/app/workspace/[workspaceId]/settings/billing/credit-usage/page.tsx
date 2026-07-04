import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { CreditUsageView } from '@/app/workspace/[workspaceId]/settings/billing/credit-usage/credit-usage-view'
import CreditUsageLoading from '@/app/workspace/[workspaceId]/settings/billing/credit-usage/loading'

export const metadata: Metadata = {
  title: 'Credit usage',
}

/**
 * `CreditUsageView` reads URL query params via nuqs (which uses
 * `useSearchParams` internally), so it must sit under a Suspense boundary.
 * The fallback renders the real chrome so a suspend never shows a blank
 * frame — `loading.tsx` covers the route-navigation transition the same way.
 *
 * Enterprise accounts manage billing out-of-band and never see this page —
 * Billing settings already hides the link to it, but hiding a link doesn't
 * stop direct navigation, so this redirects server-side before anything
 * renders (matching `getHighestPrioritySubscription`'s use elsewhere for
 * server-side plan checks).
 */
export default async function CreditUsagePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params

  const session = await getSession()
  if (session?.user?.id) {
    const subscription = await getHighestPrioritySubscription(session.user.id)
    if (isEnterprise(subscription?.plan)) {
      redirect(`/workspace/${workspaceId}/settings/billing`)
    }
  }

  return (
    <Suspense fallback={<CreditUsageLoading />}>
      <CreditUsageView workspaceId={workspaceId} />
    </Suspense>
  )
}
