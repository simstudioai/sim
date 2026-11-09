import { HydrationBoundary } from '@tanstack/react-query'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { BillingView } from '@/platform/app/(shell)/settings/_components/sections/billing/billing-view'

export default async function BillingSection({ organization, fixture }: SettingsSectionProps) {
  if (fixture) return <BillingView organization={organization} />
  const { prefetchBillingSummary } = await import('@/platform/lib/data/prefetch-billing')
  const state = await prefetchBillingSummary(organization.organization.id)
  return (
    <HydrationBoundary state={state}>
      <BillingView organization={organization} />
    </HydrationBoundary>
  )
}
