'use client'

import { FolderPlus, Plus, Upload, Workflow } from '@sim/emcn/icons'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'

/** Mirrors `WORKFLOW_COLUMNS` in `workflows-list.tsx`, so the fallback and the list line up. */
const COLUMNS = [
  { id: 'name', header: 'Name', widthMultiplier: 1.4 },
  { id: 'status', header: 'Status', widthMultiplier: 0.7 },
  { id: 'updated', header: 'Last Updated' },
]

const ACTIONS: ChromeActionSpec[] = [
  { text: 'Import workflow', icon: Upload },
  { text: 'New folder', icon: FolderPlus },
  { text: 'New workflow', icon: Plus, variant: 'primary' },
]

/**
 * The Workflows list's chrome while it suspends on its URL state. Not a route `loading.tsx`:
 * one there would also cover `w/[workflowId]`, and the canvas deliberately keeps the previous
 * view mounted through a workflow switch.
 */
export function WorkflowsListLoading() {
  return (
    <ResourceChromeFallback
      icon={Workflow}
      title='Workflows'
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search workflows...'
    />
  )
}
