import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { SecretDetail } from '@/app/workspace/[workspaceId]/settings/secrets/[credentialId]/secret-detail'
import { resolveWorkspaceGroup } from '@/ee/access-control/utils/permission-check'
import { canOpenSecretDetail } from './secret-detail-access'

export const metadata: Metadata = {
  title: 'Secret',
}

export default async function SecretDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; credentialId: string }>
}) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { workspaceId, credentialId } = await params
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, session.user.id)
  if (!hostContext) notFound()

  const [permissionGroup, access] = await Promise.all([
    hostContext.hostOrganizationId && hostContext.ownerBilling.isEnterprise
      ? resolveWorkspaceGroup(session.user.id, hostContext.hostOrganizationId, workspaceId)
      : null,
    getCredentialActorContext(credentialId, session.user.id),
  ])

  if (
    !canOpenSecretDetail({
      workspaceId,
      secretsHidden: permissionGroup?.config.hideSecretsTab === true,
      access: {
        credential: access.credential,
        hasWorkspaceAccess: access.hasWorkspaceAccess,
        hasActiveMembership: access.member?.status === 'active',
        isAdmin: access.isAdmin,
      },
    })
  ) {
    notFound()
  }

  return <SecretDetail workspaceId={workspaceId} credentialId={credentialId} />
}
