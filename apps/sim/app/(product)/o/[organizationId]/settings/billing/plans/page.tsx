import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Plans' }

/** The mode is per-request; a build must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: ProductPageProps<{ organizationId: string }>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [query, { resolvePlansEntry }, { PlanPicker }] = await Promise.all([
    searchParams,
    import('@/platform/lib/data/plans-entry'),
    import(
      '@/app/(product)/o/[organizationId]/settings/billing/plans/_components/plan-picker/plan-picker'
    ),
  ])
  const entry = await resolvePlansEntry(query)
  return entry && <PlanPicker organizationId={entry.organizationId} header={entry.header} />
}
