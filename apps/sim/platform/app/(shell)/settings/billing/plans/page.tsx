import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Plans' }

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: PageProps<'/settings/billing/plans'>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [query, { resolvePlansEntry }, { PlanPicker }] = await Promise.all([
    searchParams,
    import('@/platform/lib/data/plans-entry'),
    import('@/platform/app/(shell)/settings/billing/plans/_components/plan-picker/plan-picker'),
  ])
  const entry = await resolvePlansEntry(query)
  return entry && <PlanPicker organizationId={entry.organizationId} header={entry.header} />
}
