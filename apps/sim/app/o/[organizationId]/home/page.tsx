import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'

export const metadata: Metadata = {
  title: 'Home',
}

export default async function OrganizationHomePage() {
  const session = await getSession()

  return <OrganizationHome userName={session?.user?.name} />
}
