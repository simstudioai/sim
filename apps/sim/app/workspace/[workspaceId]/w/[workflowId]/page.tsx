import type { Metadata } from 'next'
import { WorkflowLocationBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-location-bar'
import Workflow from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow'

export const metadata: Metadata = {
  title: 'Workflow',
}

/**
 * The canvas, under the location bar the project Build view shows. The bar mounts here rather
 * than in the layout, whose module graph stays free of the canvas's query and registry modules.
 */
export default function WorkflowPage() {
  return (
    <>
      <WorkflowLocationBar />
      <div className='relative min-h-0 flex-1 overflow-hidden'>
        <Workflow />
      </div>
    </>
  )
}
