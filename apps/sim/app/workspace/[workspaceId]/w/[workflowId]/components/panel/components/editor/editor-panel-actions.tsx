'use client'

import { useCallback } from 'react'
import { Chip, Tooltip } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { getBlock } from '@/blocks/registry'
import { useFolderMap } from '@/hooks/queries/folders'
import { isWorkflowEffectivelyLocked } from '@/hooks/queries/utils/folder-tree'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useIsBlockActive, useIsCurrentWorkflowExecuting } from '@/stores/execution'
import { usePanelEditorStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface EditorPanelActionsProps {
  onClose: () => void
}

/** Block overflow and close actions displayed in the panel's shared top control row. */
export function EditorPanelActions({ onClose }: EditorPanelActionsProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const posthog = usePostHog()
  const userPermissions = useUserPermissionsContext()
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentBlockId ? currentWorkflow.getBlockById(currentBlockId) : null
  const blockConfig = currentBlock ? getBlock(currentBlock.type) : null
  const isSubflow =
    currentBlock && (currentBlock.type === 'loop' || currentBlock.type === 'parallel')
  const subflowConfig = isSubflow ? (currentBlock.type === 'loop' ? LoopTool : ParallelTool) : null
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workflowId = activeWorkflowId ?? (params.workflowId as string | undefined)
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const workflowMetadata = workflowId ? workflows[workflowId] : undefined
  const workflowLocked = isWorkflowEffectivelyLocked(workflowMetadata, folders)
  const isBlockRunning = useIsBlockActive(currentBlockId ?? '')
  const isWorkflowRunning = useIsCurrentWorkflowExecuting()

  const handleOpenDocs = useCallback(() => {
    const docsLink = isSubflow ? subflowConfig?.docsLink : blockConfig?.docsLink
    window.open(docsLink || 'https://docs.sim.ai/quick-reference', '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'docs_opened', {
      source: 'editor_button',
      block_type: currentBlock?.type,
    })
  }, [isSubflow, subflowConfig?.docsLink, blockConfig?.docsLink, posthog, currentBlock?.type])

  if (!currentBlock) return null

  return (
    <div className='flex items-center gap-1'>
      <ActionBar
        blockId={currentBlock.id}
        blockType={currentBlock.type}
        disabled={!userPermissions.canEdit || workflowLocked}
        variant='inline'
        inlineActions='menu'
        isRunning={isBlockRunning}
        isWorkflowRunning={isWorkflowRunning}
        onOpenDocs={handleOpenDocs}
      />
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Chip
            leftIcon={X}
            className='size-[30px] justify-center p-0'
            onClick={onClose}
            aria-label='Close editor and clear block selection'
          />
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          <p>Close editor</p>
        </Tooltip.Content>
      </Tooltip.Root>
    </div>
  )
}
