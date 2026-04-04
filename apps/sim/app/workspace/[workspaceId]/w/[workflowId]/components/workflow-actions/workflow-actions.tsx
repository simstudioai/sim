'use client'

import { memo, useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Layout,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  MoreHorizontal,
  Tooltip,
  Trash,
  Upload,
} from '@/components/emcn'
import { Lock, Unlock } from '@/components/emcn/icons'
import { generateWorkflowJson } from '@/lib/workflows/operations/import-export'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkflowHistory } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-toolbar/workflow-history'
import { useAutoLayout } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-auto-layout'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { getWorkflowLockToggleIds } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useDeleteWorkflow } from '@/app/workspace/[workspaceId]/w/hooks'
import { useDuplicateWorkflowMutation, useWorkflowMap } from '@/hooks/queries/workflows'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useNotificationStore } from '@/stores/notifications/store'
import { useVariablesStore as usePanelVariablesStore } from '@/stores/panel'
import { useVariablesStore } from '@/stores/variables/store'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('WorkflowActions')

/**
 * Vertical floating toolbar on the left side of the canvas.
 * Primary actions (auto layout, variables, history) are direct buttons.
 * Secondary actions (lock, export, duplicate, delete) are behind a three-dots menu.
 */
interface WorkflowActionsProps {
  workspaceId?: string
}

export const WorkflowActions = memo(function WorkflowActions({
  workspaceId: propWorkspaceId,
}: WorkflowActionsProps) {
  const router = useRouter()
  const params = useParams()
  const workspaceId = propWorkspaceId ?? (params.workspaceId as string)

  const [isAutoLayouting, setIsAutoLayouting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isMoreOpen, setIsMoreOpen] = useState(false)

  const userPermissions = useUserPermissionsContext()
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { activeWorkflowId } = useWorkflowRegistry(
    useShallow((state) => ({ activeWorkflowId: state.activeWorkflowId }))
  )
  const { handleAutoLayout: autoLayoutWithFitView } = useAutoLayout(activeWorkflowId || null)
  const duplicateWorkflowMutation = useDuplicateWorkflowMutation()
  const { collaborativeBatchToggleLocked } = useCollaborativeWorkflow()
  const { isExecuting } = useWorkflowExecution()
  const { isSnapshotView } = useCurrentWorkflow()
  const currentWorkflow = activeWorkflowId ? workflows[activeWorkflowId] : null

  const hasLockedBlocks = useWorkflowStore((state) =>
    Object.values(state.blocks).some((block) => block.locked)
  )
  const allBlocksLocked = useWorkflowStore((state) => {
    const blockList = Object.values(state.blocks)
    return blockList.length > 0 && blockList.every((block) => block.locked)
  })
  const hasBlocks = useWorkflowStore((state) => Object.keys(state.blocks).length > 0)

  const { isDeleting, handleDeleteWorkflow } = useDeleteWorkflow({
    workspaceId,
    workflowIds: activeWorkflowId || '',
    isActive: true,
    onSuccess: () => setIsDeleteModalOpen(false),
  })

  const { isOpen: isVariablesOpen, setIsOpen: setVariablesOpen } = useVariablesStore(
    useShallow((state) => ({
      isOpen: state.isOpen,
      setIsOpen: state.setIsOpen,
    }))
  )

  const handleAutoLayout = useCallback(async () => {
    if (isExecuting || !userPermissions.canEdit || isAutoLayouting) return
    setIsAutoLayouting(true)
    try {
      const result = await autoLayoutWithFitView()
      if (!result.success && result.error) {
        useNotificationStore.getState().addNotification({
          level: 'info',
          message: result.error,
          workflowId: activeWorkflowId || undefined,
        })
      }
    } finally {
      setIsAutoLayouting(false)
    }
  }, [
    isExecuting,
    userPermissions.canEdit,
    isAutoLayouting,
    autoLayoutWithFitView,
    activeWorkflowId,
  ])

  const downloadFile = useCallback((content: string, filename: string, mimeType: string) => {
    try {
      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Failed to download file:', error)
    }
  }, [])

  const handleExportJson = useCallback(async () => {
    if (!currentWorkflow || !activeWorkflowId) return
    setIsExporting(true)
    try {
      const workflow = getWorkflowWithValues(activeWorkflowId, workspaceId)
      if (!workflow || !workflow.state) throw new Error('No workflow state found')
      const workflowVariables = usePanelVariablesStore
        .getState()
        .getVariablesByWorkflowId(activeWorkflowId)
      const jsonContent = generateWorkflowJson(workflow.state, {
        workflowId: activeWorkflowId,
        name: currentWorkflow.name,
        description: currentWorkflow.description,
        variables: workflowVariables.map((v) => ({
          id: v.id,
          name: v.name,
          type: v.type,
          value: v.value,
        })),
      })
      const filename = `${currentWorkflow.name.replace(/[^a-z0-9]/gi, '-')}.json`
      downloadFile(jsonContent, filename, 'application/json')
    } catch (error) {
      logger.error('Failed to export workflow as JSON:', error)
    } finally {
      setIsExporting(false)
      setIsMoreOpen(false)
    }
  }, [currentWorkflow, activeWorkflowId, downloadFile, workspaceId])

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
        color: sourceWorkflow.color ?? '',
        folderId: sourceWorkflow.folderId,
      })
      if (result?.id) router.push(`/workspace/${workspaceId}/w/${result.id}`)
    } catch (error) {
      logger.error('Error duplicating workflow:', error)
    } finally {
      setIsDuplicating(false)
      setIsMoreOpen(false)
    }
  }, [
    activeWorkflowId,
    userPermissions.canEdit,
    isDuplicating,
    workflows,
    router,
    workspaceId,
    duplicateWorkflowMutation,
  ])

  const handleToggleWorkflowLock = useCallback(() => {
    const blocks = useWorkflowStore.getState().blocks
    const allLocked = Object.values(blocks).every((b) => b.locked)
    const ids = getWorkflowLockToggleIds(blocks, !allLocked)
    if (ids.length > 0) collaborativeBatchToggleLocked(ids)
    setIsMoreOpen(false)
  }, [collaborativeBatchToggleLocked])

  return (
    <>
      <div className='absolute top-4 left-[16px] z-10 flex w-[36px] flex-col items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-1'>
        {/* Auto layout */}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              className='h-[28px] w-[28px] rounded-md p-0 hover-hover:bg-[var(--surface-5)]'
              variant='ghost'
              onClick={handleAutoLayout}
              disabled={
                isExecuting || !userPermissions.canEdit || isAutoLayouting || hasLockedBlocks
              }
              title={hasLockedBlocks ? 'Unlock blocks to use auto-layout' : undefined}
            >
              <Layout className='h-[16px] w-[16px]' animate={isAutoLayouting} variant='clockwise' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='right'>Auto layout</Tooltip.Content>
        </Tooltip.Root>

        {/* History */}
        <WorkflowHistory open={isHistoryOpen} onOpenChange={setIsHistoryOpen} />

        <div className='my-0.5 h-[1px] w-[20px] bg-[var(--border)]' />

        {/* More actions */}
        <DropdownMenu open={isMoreOpen} onOpenChange={setIsMoreOpen}>
          <Tooltip.Root>
            <DropdownMenuTrigger asChild>
              <Tooltip.Trigger asChild>
                <Button
                  className='h-[28px] w-[28px] rounded-md p-0 hover-hover:bg-[var(--surface-5)]'
                  variant={isMoreOpen ? 'active' : 'ghost'}
                >
                  <MoreHorizontal />
                </Button>
              </Tooltip.Trigger>
            </DropdownMenuTrigger>
            {!isMoreOpen && <Tooltip.Content side='right'>More actions</Tooltip.Content>}
          </Tooltip.Root>
          <DropdownMenuContent align='start' side='right' sideOffset={8}>
            {userPermissions.canAdmin && !isSnapshotView && (
              <DropdownMenuItem onSelect={handleToggleWorkflowLock} disabled={!hasBlocks}>
                {allBlocksLocked ? <Unlock /> : <Lock />}
                {allBlocksLocked ? 'Unlock workflow' : 'Lock workflow'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={handleExportJson}
              disabled={!userPermissions.canEdit || isExporting || !currentWorkflow}
            >
              <Upload />
              Export workflow
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={handleDuplicateWorkflow}
              disabled={!userPermissions.canEdit || isDuplicating}
            >
              <Copy animate={isDuplicating} />
              Duplicate workflow
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setIsDeleteModalOpen(true)}
              disabled={!userPermissions.canEdit || Object.keys(workflows).length <= 1}
            >
              <Trash />
              Delete workflow
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Workflow</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {currentWorkflow?.name ?? 'this workflow'}
              </span>
              ?{' '}
              <span className='text-[var(--text-error)]'>
                All associated blocks, executions, and configuration will be removed.
              </span>{' '}
              <span className='text-[var(--text-tertiary)]'>
                You can restore it from Recently Deleted in Settings.
              </span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDeleteWorkflow} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
})
