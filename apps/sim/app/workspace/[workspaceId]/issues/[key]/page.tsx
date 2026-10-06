import type { Metadata } from 'next'
import { IssueDetail } from '@/app/workspace/[workspaceId]/issues/components/issue-detail'

export const metadata: Metadata = { title: 'Issue', robots: { index: false } }

interface IssuePageProps {
  params: Promise<{ workspaceId: string; key: string }>
}

export default async function IssuePage({ params }: IssuePageProps) {
  const { workspaceId, key } = await params
  return <IssueDetail workspaceId={workspaceId} issueKey={key} />
}
