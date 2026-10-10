import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Changelog } from '@/app/workspace/[workspaceId]/changelog/changelog'
import ChangelogLoading from '@/app/workspace/[workspaceId]/changelog/loading'

export const metadata: Metadata = { title: 'Changelog', robots: { index: false } }

interface ChangelogPageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function ChangelogPage({ params }: ChangelogPageProps) {
  const { workspaceId } = await params
  return (
    <Suspense fallback={<ChangelogLoading />}>
      <Changelog workspaceId={workspaceId} />
    </Suspense>
  )
}
