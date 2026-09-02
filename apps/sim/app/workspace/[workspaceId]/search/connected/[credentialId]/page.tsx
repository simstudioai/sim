import type { Metadata } from 'next'
import { SearchCredentialDetail } from '@/app/workspace/[workspaceId]/search/connected/[credentialId]/search-credential-detail'

export const metadata: Metadata = {
  title: 'Connected Sim Search Connector',
}

export default async function SearchCredentialPage({
  params,
}: {
  params: Promise<{ workspaceId: string; credentialId: string }>
}) {
  const { workspaceId, credentialId } = await params
  return <SearchCredentialDetail workspaceId={workspaceId} credentialId={credentialId} />
}
