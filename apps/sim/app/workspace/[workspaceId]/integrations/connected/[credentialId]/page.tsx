import type { Metadata } from 'next'
import { ConnectedCredentialDetail } from '@/app/workspace/[workspaceId]/integrations/connected/[credentialId]/connected-credential-detail'

export const metadata: Metadata = {
  title: 'Connected Integration',
}

export default async function ConnectedCredentialPage({
  params,
}: {
  params: Promise<{ workspaceId: string; credentialId: string }>
}) {
  const { workspaceId, credentialId } = await params
  return <ConnectedCredentialDetail workspaceId={workspaceId} credentialId={credentialId} />
}
