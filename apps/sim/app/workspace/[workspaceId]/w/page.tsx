'use client'

import { lazy, Suspense } from 'react'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { FirstWorkflowRedirect } from '@/app/workspace/[workspaceId]/w/components/first-workflow-redirect/first-workflow-redirect'
import { WorkflowsListLoading } from '@/app/workspace/[workspaceId]/w/components/workflows-list'

/** Loaded only with the org project view on, so the classic route does not ship it. */
const WorkflowsList = lazy(() =>
  import('@/app/workspace/[workspaceId]/w/components/workflows-list/workflows-list').then((m) => ({
    default: m.WorkflowsList,
  }))
)

/**
 * The `/w` route. With the org project view on it is the Workflows index page: the folder
 * tree in the content area, like Files, Tables, and Knowledge. `WorkflowsList` reads URL
 * query params via nuqs (which uses `useSearchParams` internally), so it sits under a
 * Suspense boundary whose fallback renders the real chrome. Otherwise the route keeps its
 * classic behavior and lands on the first workflow's canvas.
 */
export default function WorkflowsPage() {
  const orgProjectViewEnabled = useFeatureFlag('org-project-view')

  if (!orgProjectViewEnabled) return <FirstWorkflowRedirect />

  return (
    <Suspense fallback={<WorkflowsListLoading />}>
      <WorkflowsList />
    </Suspense>
  )
}
