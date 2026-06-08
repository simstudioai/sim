import type { Metadata } from 'next'
import { Upgrade } from '@/app/workspace/[workspaceId]/upgrade/upgrade'

export const metadata: Metadata = { title: 'Upgrade' }

export default async function UpgradePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  return <Upgrade workspaceId={workspaceId} />
}
