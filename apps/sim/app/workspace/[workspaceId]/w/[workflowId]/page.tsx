import type { Metadata } from 'next'
import Workflow from '@/components/workflow-editor/workflow'

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
