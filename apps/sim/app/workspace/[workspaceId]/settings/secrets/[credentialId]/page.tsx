import { Suspense } from 'react'
import type { Metadata } from 'next'
import SecretDetailLoading from '@/app/workspace/[workspaceId]/settings/secrets/[credentialId]/loading'
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
  return (
    <Suspense fallback={<SecretDetailLoading />}>
      <SecretDetail workspaceId={workspaceId} credentialId={credentialId} />
    </Suspense>
  )
}
