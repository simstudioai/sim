'use client'

import { WorkflowLoader } from '@/components/ui/workflow-loader'
import { usePendingWorkflowNavigation } from '@/app/workspace/[workspaceId]/w/components/workflow-navigation/workflow-navigation-provider'

interface WorkflowLoadingOverlayProps {
  isLoading: boolean
  embedded?: boolean
}

/** Covers the current canvas from navigation intent through destination hydration. */
export function WorkflowLoadingOverlay({
  isLoading,
  embedded = false,
}: WorkflowLoadingOverlayProps) {
  const isNavigating = usePendingWorkflowNavigation()
  if (!isLoading && (embedded || !isNavigating)) return null

  return (
    <div className='absolute inset-0 z-[5] flex items-center justify-center bg-[var(--bg)]'>
      <WorkflowLoader />
    </div>
  )
}
