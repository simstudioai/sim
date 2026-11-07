import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PersonProfile } from '@/platform/app/(shell)/people/_components/person/person'
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
  return <PersonProfile organizationId={organization.organization.id} memberId={memberId} />
}
