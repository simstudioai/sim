import type { Metadata } from 'next'
import { WorkflowWithChat } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/docked-chat'

export const metadata: Metadata = {
  title: 'Workflow',
}

export default WorkflowWithChat
