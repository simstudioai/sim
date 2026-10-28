import { Suspense } from 'react'
import type { Metadata } from 'next'
import TestsLoading from '@/app/workspace/[workspaceId]/tests/loading'
import { Tests } from '@/app/workspace/[workspaceId]/tests/tests'

export const metadata: Metadata = { title: 'Tests', robots: { index: false } }

interface TestsPageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function TestsPage({ params }: TestsPageProps) {
  const { workspaceId } = await params
  return (
    <Suspense fallback={<TestsLoading />}>
      <Tests workspaceId={workspaceId} />
    </Suspense>
  )
}
