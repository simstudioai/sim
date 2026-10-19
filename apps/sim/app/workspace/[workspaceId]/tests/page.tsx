import { Suspense } from 'react'
import type { Metadata } from 'next'
import TestsLoading from '@/app/workspace/[workspaceId]/tests/loading'
import { Tests } from '@/app/workspace/[workspaceId]/tests/tests'

export const metadata: Metadata = { title: 'Tests', robots: { index: false } }

export default function TestsPage() {
  return (
    <Suspense fallback={<TestsLoading />}>
      <Tests />
    </Suspense>
  )
}
