import { HydrationBoundary } from '@tanstack/react-query'
import { redirect } from 'next/navigation'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { BillingView } from '@/app/(product)/o/[organizationId]/settings/_components/sections/billing/billing-view'
import { surfaceHref } from '@/platform/lib/data/organization-model'

export default async function BillingSection({
  organization,
  fixture,
  subpath,
}: SettingsSectionProps) {
  if (fixture) return <BillingView organization={organization} subpath={subpath} />
  const { prefetchBillingSummary } = await import('@/platform/lib/data/prefetch-billing')
  const { state, enterprise } = await prefetchBillingSummary(organization.organization.id)
  // Enterprise has no credit usage page: its link returns to Subscription before anything renders.
  if (subpath[0] === 'credit-usage' && enterprise)
    redirect(surfaceHref(organization, '/settings/billing'))
  return (
    <HydrationBoundary state={state}>
      <BillingView organization={organization} subpath={subpath} />
    </HydrationBoundary>
  )
}
