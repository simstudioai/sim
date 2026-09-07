import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import OrganizationHomeLoading from '@/app/o/[organizationId]/home/loading'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'

export const metadata: Metadata = {
  title: 'Home',
}

export default async function OrganizationHomePage() {
  const session = await getSession()

  return (
    <Suspense fallback={<OrganizationHomeLoading />}>
      <OrganizationHome userName={session?.user?.name} />
    </Suspense>
  )
}
