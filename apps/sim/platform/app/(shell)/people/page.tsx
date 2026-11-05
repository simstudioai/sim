import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PeoplePage } from '@/platform/app/(shell)/people/_components/people-page/people-page'
import PeopleLoading from '@/platform/app/(shell)/people/loading'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'People' }

/** The mode and the gate are per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page() {
  if (resolvePlatformMode() !== 'live') notFound()
  const { requirePeopleAccess } = await import(
    '@/platform/app/(shell)/people/_components/people-access'
  )
  const organization = await requirePeopleAccess()
  if (!organization) return null
  return (
    <Suspense fallback={<PeopleLoading />}>
      <PeoplePage organization={organization} />
    </Suspense>
  )
}
