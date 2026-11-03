import { Suspense } from 'react'
import { getSession } from '@/lib/auth'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import ExtensionLoading from '@/app/extension/loading'
import { ExtensionOrganization } from '@/app/extension/o/[organizationId]/organization'
import { ExtensionSignIn } from '@/app/extension/sign-in'
import { ExtensionUnavailable } from '@/app/extension/unavailable'

interface ExtensionOrganizationPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function ExtensionOrganizationPage({
  params,
}: ExtensionOrganizationPageProps) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user) return <ExtensionSignIn />
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (
    !context ||
    !context.mothershipAvailable ||
    (!context.canBuild && !context.searchAccess.memberScoped)
  ) {
    return <ExtensionUnavailable scope='organization' />
  }
  return (
    <Suspense fallback={<ExtensionLoading />}>
      <ExtensionOrganization key={organizationId} context={context} />
    </Suspense>
  )
}
