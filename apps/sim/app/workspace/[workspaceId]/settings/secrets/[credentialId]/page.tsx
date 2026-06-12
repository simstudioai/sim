import type { Metadata } from 'next'
import { SecretDetail } from '@/app/workspace/[workspaceId]/settings/secrets/[credentialId]/secret-detail'

export const metadata: Metadata = {
  title: 'Secret',
}

export default async function SecretDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; credentialId: string }>
}) {
  const { workspaceId, credentialId } = await params
  return <SecretDetail workspaceId={workspaceId} credentialId={credentialId} />
}
