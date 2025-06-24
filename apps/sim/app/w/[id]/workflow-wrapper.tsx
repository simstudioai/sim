'use client'

import { useParams } from 'next/navigation'
import { WorkflowOperationProvider } from '@/contexts/workflow-operation-context'
import WorkflowComponent from './workflow'

/**
 * Wrapper component that provides the workflow operation context
 * and conditionally renders the save button based on collaboration settings
 */
export default function WorkflowWrapper() {
  const params = useParams()
  const workflowId = params.id as string

  if (!workflowId) {
    return <div>Invalid workflow ID</div>
  }

  return (
    <WorkflowOperationProvider workflowId={workflowId}>
      <WorkflowComponent />
    </WorkflowOperationProvider>
  )
}
