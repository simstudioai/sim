import type { Metadata } from 'next'
import { Issues } from '@/app/workspace/[workspaceId]/issues/issues'

export const metadata: Metadata = { title: 'Issues', robots: { index: false } }

interface IssuesPageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function IssuesPage({ params }: IssuesPageProps) {
  const { workspaceId } = await params
  return <Issues workspaceId={workspaceId} />
}
