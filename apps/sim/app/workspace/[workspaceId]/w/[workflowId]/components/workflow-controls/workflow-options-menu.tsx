'use client'

import { useCallback, useState } from 'react'
import {
  Button,
  ChipConfirmModal,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Duplicate,
  Layout,
  MoreHorizontal,
  Tooltip,
  Trash,
  toast,
} from '@sim/emcn'
import { BubbleChatClose, BubbleChatPreview, Download, Lock, Unlock } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { VariableIcon } from '@/components/icons'
import { generateWorkflowJson } from '@/lib/workflows/operations/import-export'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useAutoLayout } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-auto-layout'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { getWorkflowLockToggleIds } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useDeleteWorkflow } from '@/app/workspace/[workspaceId]/w/hooks'
import { useFolderMap } from '@/hooks/queries/folders'
import { isWorkflowEffectivelyLocked } from '@/hooks/queries/utils/folder-tree'
import { useDuplicateWorkflowMutation, useWorkflowMap } from '@/hooks/queries/workflows'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useChatStore } from '@/stores/chat/store'
import { useVariablesModalStore } from '@/stores/variables/modal'
import { useVariablesStore } from '@/stores/variables/store'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('WorkflowOptionsMenu')

interface WorkflowOptionsMenuProps {
  isExecuting: boolean
}

export function WorkflowOptionsMenu({ isExecuting }: WorkflowOptionsMenuProps) {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isAutoLayouting, setIsAutoLayouting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const userPermissions = useUserPermissionsContext()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const duplicateWorkflowMutation = useDuplicateWorkflowMutation()
  const { handleAutoLayout: autoLayoutWithFitView } = useAutoLayout(activeWorkflowId || null)
  const { collaborativeBatchToggleLocked } = useCollaborativeWorkflow()
  const { isSnapshotView } = useCurrentWorkflow()
  const { isChatOpen, setIsChatOpen } = useChatStore(
    useShallow((state) => ({
      isChatOpen: state.isChatOpen,
      setIsChatOpen: state.setIsChatOpen,
    }))
  )
  const { isOpen: isVariablesOpen, setIsOpen: setVariablesOpen } = useVariablesModalStore(
    useShallow((state) => ({
      isOpen: state.isOpen,
      setIsOpen: state.setIsOpen,
    }))
  )
  const hasLockedBlocks = useWorkflowStore((state) =>
    Object.values(state.blocks).some((block) => block.locked)
  )
  const allBlocksLocked = useWorkflowStore((state) => {
    const blockList = Object.values(state.blocks)
    return blockList.length > 0 && blockList.every((block) => block.locked)
  })
  const hasBlocks = useWorkflowStore((state) => Object.keys(state.blocks).length > 0)
  const currentWorkflow = activeWorkflowId ? workflows[activeWorkflowId] : null
  const workflowLocked = isWorkflowEffectivelyLocked(currentWorkflow, folders)
  const canMutateWorkflow = userPermissions.canEdit && !workflowLocked
  const { isDeleting, handleDeleteWorkflow } = useDeleteWorkflow({
    workspaceId,
    workflowIds: activeWorkflowId || '',
    isActive: true,
    onSuccess: () => setIsDeleteModalOpen(false),
  })

  const downloadFile = useCallback((content: string, filename: string, mimeType: string) => {
    try {
      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Failed to download file:', error)
    }
  }, [])

  const handleAutoLayout = useCallback(async () => {
    if (isExecuting || !canMutateWorkflow || isAutoLayouting) return

    setIsAutoLayouting(true)
    try {
      const result = await autoLayoutWithFitView()
      if (!result.success && result.error) toast({ message: result.error })
    } finally {
      setIsAutoLayouting(false)
    }
  }, [isExecuting, canMutateWorkflow, isAutoLayouting, autoLayoutWithFitView])

  const handleExportJson = useCallback(async () => {
    if (!currentWorkflow || !activeWorkflowId) {
      logger.warn('No active workflow to export')
      return
    }

    setIsExporting(true)
    try {
      const workflow = getWorkflowWithValues(activeWorkflowId, workspaceId)
      if (!workflow?.state) throw new Error('No workflow state found')

      const workflowVariables = useVariablesStore
        .getState()
        .getVariablesByWorkflowId(activeWorkflowId)
      const jsonContent = generateWorkflowJson(workflow.state, {
        workflowId: activeWorkflowId,
        name: currentWorkflow.name,
        description: currentWorkflow.description,
        variables: workflowVariables.map((variable) => ({
          id: variable.id,
          name: variable.name,
          type: variable.type,
          value: variable.value,
        })),
      })

      const filename = `${currentWorkflow.name.replace(/[^a-z0-9]/gi, '-')}.json`
      downloadFile(jsonContent, filename, 'application/json')
      logger.info('Workflow exported as JSON')
    } catch (error) {
      logger.error('Failed to export workflow as JSON:', error)
    } finally {
      setIsExporting(false)
      setIsMenuOpen(false)
    }
  }, [currentWorkflow, activeWorkflowId, workspaceId, downloadFile])

  const handleDuplicateWorkflow = useCallback(async () => {
    if (!activeWorkflowId || !userPermissions.canEdit || isDuplicating) return

    const sourceWorkflow = workflows[activeWorkflowId]
    if (!sourceWorkflow) return

    setIsDuplicating(true)
    try {
      const result = await duplicateWorkflowMutation.mutateAsync({
        workspaceId,
        sourceId: activeWorkflowId,
        name: `${sourceWorkflow.name} (Copy)`,
        description: sourceWorkflow.description,
        folderId: sourceWorkflow.folderId,
      })
      if (result?.id) router.push(`/workspace/${workspaceId}/w/${result.id}`)
    } catch (error) {
      logger.error('Error duplicating workflow:', error)
    } finally {
      setIsDuplicating(false)
      setIsMenuOpen(false)
    }
  }, [
    activeWorkflowId,
    userPermissions.canEdit,
    isDuplicating,
    workflows,
    duplicateWorkflowMutation,
    workspaceId,
    router,
  ])

  const handleToggleWorkflowLock = useCallback(() => {
    const blocks = useWorkflowStore.getState().blocks
    const allLocked = Object.values(blocks).every((block) => block.locked)
    const ids = getWorkflowLockToggleIds(blocks, !allLocked)
    if (ids.length > 0) collaborativeBatchToggleLocked(ids)
    setIsMenuOpen(false)
  }, [collaborativeBatchToggleLocked])

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                className='size-[28px] rounded-md p-0 hover-hover:bg-[var(--surface-5)]'
                aria-label='Workflow options'
              >
                <MoreHorizontal className='size-[16px]' />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>Workflow options</Tooltip.Content>
        </Tooltip.Root>
        <DropdownMenuContent align='center' side='bottom' sideOffset={6}>
          <DropdownMenuItem onSelect={() => setIsChatOpen(!isChatOpen)}>
            {isChatOpen ? <BubbleChatClose /> : <BubbleChatPreview />}
            {isChatOpen ? 'Close test chat' : 'Test in chat'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={handleAutoLayout}
            disabled={isExecuting || !canMutateWorkflow || isAutoLayouting || hasLockedBlocks}
            title={hasLockedBlocks ? 'Unlock blocks to use auto-layout' : undefined}
          >
            <Layout animate={isAutoLayouting} variant='clockwise' />
            Auto layout
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setVariablesOpen(!isVariablesOpen)}>
            <VariableIcon />
            Variables
          </DropdownMenuItem>
          {userPermissions.canAdmin && !isSnapshotView && (
            <DropdownMenuItem
              onSelect={handleToggleWorkflowLock}
              disabled={!hasBlocks || workflowLocked}
              title={
                workflowLocked
                  ? 'Workflow is locked at the row or folder level — release it from the workflow notification or folder menu'
                  : undefined
              }
            >
              {allBlocksLocked ? <Unlock /> : <Lock />}
              {allBlocksLocked ? 'Unlock workflow' : 'Lock workflow'}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={handleExportJson}
            disabled={!userPermissions.canEdit || isExporting || !currentWorkflow}
          >
            <Download />
            Export workflow
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={handleDuplicateWorkflow}
            disabled={!userPermissions.canEdit || isDuplicating}
          >
            <Duplicate />
            Duplicate workflow
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setIsDeleteModalOpen(true)}
            disabled={!canMutateWorkflow || Object.keys(workflows).length <= 1}
          >
            <Trash />
            Delete workflow
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChipConfirmModal
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        srTitle='Delete Workflow'
        title='Delete Workflow'
        text={[
          'Are you sure you want to delete ',
          { text: currentWorkflow?.name ?? 'this workflow', bold: true },
          '? ',
          {
            text: 'All associated blocks, executions, and configuration will be removed.',
            error: true,
          },
          ' You can restore it from Recently Deleted in Settings.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDeleteWorkflow,
          pending: isDeleting,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
