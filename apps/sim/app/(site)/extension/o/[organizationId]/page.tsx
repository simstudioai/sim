import { Suspense } from 'react'
import { getSession } from '@/lib/auth'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import ExtensionLoading from '@/app/(site)/extension/loading'
import { ExtensionOrganization } from '@/app/(site)/extension/o/[organizationId]/organization'
import { ExtensionSessionExpired } from '@/app/(site)/extension/providers'
import { ExtensionUnavailable } from '@/app/(site)/extension/unavailable'

interface ExtensionOrganizationPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function ExtensionOrganizationPage({
  params,
}: ExtensionOrganizationPageProps) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user) return <ExtensionSessionExpired />
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context?.mothershipAvailable) {
    return <ExtensionUnavailable scope='organization' />
  }
  return (
    <Suspense fallback={<ExtensionLoading />}>
      <ExtensionOrganization key={organizationId} context={context} />
    </Suspense>
  )
}
