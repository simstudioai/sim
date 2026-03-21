'use client'

import { WorkflowTour } from '@/app/workspace/[workspaceId]/components/product-tour'
import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error'

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='flex h-full flex-1 flex-col overflow-hidden'>
      <ErrorBoundary>{children}</ErrorBoundary>
      <div className='absolute h-0 w-0 overflow-hidden'>
        <WorkflowTour />
      </div>
    </main>
  )
}
