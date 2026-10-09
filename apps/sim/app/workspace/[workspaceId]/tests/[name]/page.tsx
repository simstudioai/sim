import type { Metadata } from 'next'
import { TestDetail } from '@/app/workspace/[workspaceId]/tests/components'

export const metadata: Metadata = { title: 'Test', robots: { index: false } }

interface TestPageProps {
  params: Promise<{ workspaceId: string; name: string }>
}

export default async function TestPage({ params }: TestPageProps) {
  const { workspaceId, name } = await params
  return <TestDetail workspaceId={workspaceId} name={decodeURIComponent(name)} />
}
