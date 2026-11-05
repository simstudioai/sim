import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { isPeopleEnabled } from '@/lib/people/feature-flag'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import PageLoading from '@/app/o/[organizationId]/people/loading'
import { PeopleSurface } from '@/app/o/[organizationId]/people/people-surface'
import { PeoplePage as PeopleView } from '@/platform/app/(shell)/people/_components/people-page/people-page'

export const metadata: Metadata = { title: 'People' }

interface PeoplePageProps {
  params: Promise<{ organizationId: string }>
}

export default async function PeoplePage({ params }: PeoplePageProps) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: organizationRoutes(organizationId).people,
        isInviteFlow: false,
      })
    )
  if (!(await isPeopleEnabled(organizationId))) notFound()
  return (
    <Suspense fallback={<PageLoading />}>
      <PeopleSurface>
        <PeopleView />
      </PeopleSurface>
    </Suspense>
  )
}
