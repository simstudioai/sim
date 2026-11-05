import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PersonProfile } from '@/platform/app/(shell)/people/_components/person/person'
import PersonLoading from '@/platform/app/(shell)/people/[memberId]/loading'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'People' }

export default async function Page({ params }: PageProps<'/people/[memberId]'>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const { requirePeopleAccess } = await import(
    '@/platform/app/(shell)/people/_components/people-access'
  )
  const organization = await requirePeopleAccess()
  if (!organization) return null
  const { memberId } = await params
  return (
    <Suspense fallback={<PersonLoading />}>
      <PersonProfile organization={organization} memberId={memberId} />
    </Suspense>
  )
}
