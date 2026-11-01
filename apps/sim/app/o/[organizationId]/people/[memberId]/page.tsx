import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { isPeopleEnabled } from '@/lib/people/feature-flag'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { Person } from '@/app/o/[organizationId]/people/[memberId]/person'

export const metadata: Metadata = { title: 'People' }

interface PersonPageProps {
  params: Promise<{ organizationId: string; memberId: string }>
}

export default async function PersonPage({ params }: PersonPageProps) {
  const { organizationId, memberId } = await params
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: organizationRoutes(organizationId).person(memberId),
        isInviteFlow: false,
      })
    )
  if (!(await isPeopleEnabled(organizationId))) notFound()
  return <Person organizationId={organizationId} memberId={memberId} />
}
