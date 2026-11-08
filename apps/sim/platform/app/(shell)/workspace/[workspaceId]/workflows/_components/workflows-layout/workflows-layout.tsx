'use client'

import { type ReactNode, useEffect } from 'react'
import { getCustomBlockTile } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/block-tile/custom-block-tile'
import {
  buildCustomBlockConfig,
  hydrateClientCustomBlocks,
  useCustomBlocks,
} from '@/platform/lib/data/workflows'
import { WorkflowWorkspaceProviders } from '@/platform/lib/data/workflows/providers'

/**
 * Hydrates the client custom-block overlay from the workspace's organization blocks, as the legacy
 * workspace layout does, so the canvas, the toolbar and the editor resolve them synchronously. A
 * block published without an image takes the default glyph.
 */
function CustomBlocksLoader({ workspaceId }: { workspaceId: string }) {
  const { data } = useCustomBlocks(workspaceId)
  useEffect(() => {
    hydrateClientCustomBlocks(
      (data ?? []).map((block) =>
        buildCustomBlockConfig(
          {
            type: block.type,
            name: block.name,
            description: block.description,
            workflowId: block.workflowId,
            workspaceName: block.workspaceName,
            exposedOutputs: block.exposedOutputs,
          },
          block.inputFields,
          { ...getCustomBlockTile(block.iconUrl), hideFromToolbar: !block.enabled }
        )
      )
    )
  }, [data])
  return null
}

interface WorkflowsLayoutProps {
  workspaceId: string
  children: ReactNode
}

/** Everything the Workflows tab's list and editor run on, mounted once for both. */
export function WorkflowsLayout({ workspaceId, children }: WorkflowsLayoutProps) {
  return (
    <WorkflowWorkspaceProviders workspaceId={workspaceId}>
      <CustomBlocksLoader workspaceId={workspaceId} />
      {children}
    </WorkflowWorkspaceProviders>
  )
}
