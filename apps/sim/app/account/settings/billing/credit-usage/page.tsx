import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAccountSettingsHref } from '@/components/settings/navigation'
import { getSession } from '@/lib/auth'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/plan'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { CreditUsageView } from '@/app/workspace/[workspaceId]/settings/billing/credit-usage/credit-usage-view'
import { CreditUsageLoading } from '@/app/workspace/[workspaceId]/settings/billing/credit-usage/loading'

export const metadata: Metadata = {
  title: 'Credit usage - Account settings',
}

export default async function AccountCreditUsagePage() {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const subscription = await getHighestPriorityPersonalSubscription(session.user.id)
  if (isEnterprise(subscription?.plan)) redirect(getAccountSettingsHref('billing'))

  return (
    <Suspense fallback={<CreditUsageLoading backHref={getAccountSettingsHref('billing')} />}>
      <CreditUsageView />
    </Suspense>
  )
}
