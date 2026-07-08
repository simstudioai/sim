import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Upgrade } from '@/app/workspace/[workspaceId]/upgrade/upgrade'

export const metadata: Metadata = { title: 'Upgrade' }

export default async function UpgradePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  return (
    <Suspense fallback={<div className='h-full bg-[var(--bg)]' />}>
      <Upgrade workspaceId={workspaceId} />
    </Suspense>
  )
}
