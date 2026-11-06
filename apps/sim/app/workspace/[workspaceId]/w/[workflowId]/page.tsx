import type { Metadata } from 'next'
import Workflow from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow'

export const metadata: Metadata = {
  title: 'Workflow',
}

interface WorkflowPageProps {
  params: Promise<{ workspaceId: string; workflowId: string }>
}

export default async function WorkflowPage({ params }: WorkflowPageProps) {
  const { workspaceId, workflowId } = await params
  return <Workflow workspaceId={workspaceId} workflowId={workflowId} />
}
