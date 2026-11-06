import { Suspense } from 'react'
import type { Metadata } from 'next'
import Loading from '@/app/o/[organizationId]/integrations/accounts/[credentialId]/loading'
import { AccountToolPermissions } from '@/app/o/[organizationId]/integrations/accounts/[credentialId]/tool-permissions'

export const metadata: Metadata = { title: 'Tool permissions', referrer: 'no-referrer' }

interface AccountToolPermissionsPageProps {
  params: Promise<{ organizationId: string; credentialId: string }>
}

export default async function AccountToolPermissionsPage({
  params,
}: AccountToolPermissionsPageProps) {
  return (
    <Suspense fallback={<Loading />}>
      <AccountToolPermissions {...(await params)} />
    </Suspense>
  )
}
