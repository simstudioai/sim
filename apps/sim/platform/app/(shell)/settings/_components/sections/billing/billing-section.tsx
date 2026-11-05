import { HydrationBoundary } from '@tanstack/react-query'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { BillingView } from '@/platform/app/(shell)/settings/_components/sections/billing/billing-view'
import { prefetchBillingSummary } from '@/platform/lib/data/billing-prefetch'

export default async function BillingSection({ organization }: SettingsSectionProps) {
  const state = await prefetchBillingSummary(organization.organization.id)
  return (
    <HydrationBoundary state={state}>
      <BillingView organization={organization} />
    </HydrationBoundary>
  )
}
