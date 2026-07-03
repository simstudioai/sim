import { Suspense } from 'react'
import type { Metadata } from 'next'
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
 */
export default async function CreditUsagePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  return (
    <Suspense fallback={<CreditUsageLoading />}>
      <CreditUsageView workspaceId={workspaceId} />
    </Suspense>
  )
}
