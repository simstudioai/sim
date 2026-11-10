'use client'

import { useCallback, useMemo, useState } from 'react'
import { type BreadcrumbItem, Breadcrumbs } from '@sim/emcn/breadcrumbs'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@/lib/toast/sink'
import { RequestAccessModal } from '@/app/(product)/_components/request-access-modal/request-access-modal'
import { CANVAS_VIEWPORT_OPTIONS } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-canvas/workflow-canvas-constants'
import { useRegisterGlobalCommands } from '@/app/(product)/_components/workspace/workflows/global-commands/global-commands'
import { DeployButton } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/deploy/deploy-button/deploy-button'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { getMyAccessRequestHref } from '@/platform/lib/data/requests'
import {
  createCommand,
  createLogger,
  generateWorkflowJson,
  getWorkflowLockToggleIds,
  getWorkflowWithValues,
  getWorkspaceUsageLimitAction,
  isWorkflowEffectivelyLocked,
  useAutoLayout,
  useCollaborativeWorkflow,
  useDeleteWorkflowMutation,
  useDeploymentShape,
  useDuplicateWorkflowMutation,
  useFolderMap,
  useSession,
  useUpdateWorkflow,
  useUserPermissionsContext,
  useVariablesModalStore,
  useVariablesStore,
  useWorkflowExecution,
  useWorkflowMap,
  useWorkflowRegistry,
  useWorkflowStore,
  useWorkspaceHostContextQuery,
  useWorkspaceUsageGate,
} from '@/platform/lib/data/workflows'
import { folderChain } from '@/platform/lib/folder-chain'
import { usePlatformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

const logger = createLogger('WorkflowHeader')

/** The list's folder parameter, which the breadcrumbs use for each ancestor folder. */
const FOLDER_PARAM = 'folderId'

function listHref(workspaceId: string, folderId?: string) {
  const path = `/workspace/${encodeURIComponent(workspaceId)}/workflows`
  return folderId ? `${path}?${FOLDER_PARAM}=${encodeURIComponent(folderId)}` : path
}

function downloadJson(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

interface WorkflowHeaderProps {
  workspaceId: string
  workflowId: string
}

/**
 * The legacy panel header's workflow commands, as Platform chrome: the workflow's own commands
 * (rename, duplicate, export, delete) on its crumb, beneath Workflows and its folders.
 */
export function WorkflowTrail({ workspaceId, workflowId }: WorkflowHeaderProps) {
  const router = useRouter()
  const hrefFor = usePlatformHref()
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const userPermissions = useUserPermissionsContext()
  const workflow = workflows[workflowId]
  const workflowLocked = isWorkflowEffectivelyLocked(workflow ?? null, folders)
  const canMutateWorkflow = userPermissions.canEdit && !workflowLocked

  const updateWorkflow = useUpdateWorkflow()
  const duplicateWorkflow = useDuplicateWorkflowMutation()
  const deleteWorkflow = useDeleteWorkflowMutation()
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const exportJson = useCallback(() => {
    if (!workflow) return
    try {
      const withValues = getWorkflowWithValues(workflowId, workspaceId)
      if (!withValues?.state) throw new Error('No workflow state found')
      const variables = useVariablesStore.getState().getVariablesByWorkflowId(workflowId)
      const json = generateWorkflowJson(withValues.state, {
        workflowId,
        name: workflow.name,
        description: workflow.description,
        variables: variables.map((variable) => ({
          id: variable.id,
          name: variable.name,
          type: variable.type,
          value: variable.value,
        })),
      })
      downloadJson(json, `${workflow.name.replace(/[^a-z0-9]/gi, '-')}.json`)
    } catch (error) {
      logger.error('Failed to export workflow as JSON', { error })
    }
  }, [workflow, workflowId, workspaceId])

  const duplicate = useCallback(async () => {
    if (!workflow || !userPermissions.canEdit || duplicateWorkflow.isPending) return
    try {
      const result = await duplicateWorkflow.mutateAsync({
        workspaceId,
        sourceId: workflowId,
        name: `${workflow.name} (Copy)`,
        description: workflow.description,
        folderId: workflow.folderId,
      })
      if (result?.id) {
        router.push(
          hrefFor(
            `/workspace/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(result.id)}`
          )
        )
      }
    } catch (error) {
      logger.error('Error duplicating workflow', { error })
    }
  }, [
    workflow,
    userPermissions.canEdit,
    duplicateWorkflow,
    workspaceId,
    workflowId,
    router,
    hrefFor,
  ])

  const actions: MenuAction[] = [
    {
      id: 'rename',
      label: 'Rename',
      icon: 'I036',
      disabled: !canMutateWorkflow,
      onSelect: () => {
        setDraftName(workflow?.name ?? '')
        setRenaming(true)
      },
    },
    {
      id: 'duplicate',
      label: 'Duplicate workflow',
      icon: 'I006',
      disabled: !userPermissions.canEdit || duplicateWorkflow.isPending,
      onSelect: () => void duplicate(),
    },
    {
      id: 'export',
      label: 'Export workflow',
      icon: 'I049',
      disabled: !userPermissions.canEdit || !workflow,
      onSelect: exportJson,
    },
    {
      id: 'delete',
      label: 'Delete workflow',
      icon: 'I061',
      separatorBefore: true,
      destructive: true,
      disabled: !canMutateWorkflow || Object.keys(workflows).length <= 1,
      onSelect: () => setConfirmingDelete(true),
    },
  ]

  const items: BreadcrumbItem[] = [
    { id: 'workflows', label: 'Workflows', href: hrefFor(listHref(workspaceId)) },
    ...folderChain(folders, workflow?.folderId).map((folder) => ({
      id: folder.id,
      label: folder.name,
      href: hrefFor(listHref(workspaceId, folder.id)),
    })),
    ...(workflow ? [{ id: workflowId, label: workflow.name, actions }] : []),
  ]

  return (
    <>
      <Breadcrumbs label='Location' items={items} />
      <Modal
        open={renaming}
        onOpenChange={setRenaming}
        title='Rename workflow'
        confirmLabel='Rename'
        confirmDisabled={!draftName.trim() || draftName.trim() === workflow?.name}
        submitOnEnter
        onConfirm={() =>
          updateWorkflow.mutateAsync({
            workspaceId,
            workflowId,
            metadata: { name: draftName.trim() },
          })
        }
      >
        <TextField
          label='Name'
          placeholder='Workflow name'
          value={draftName}
          onChange={setDraftName}
        />
      </Modal>
      <Modal
        variant='confirm'
        destructive
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title='Delete workflow'
        description={`Delete "${workflow?.name ?? 'this workflow'}"? You can restore it from Recently deleted.`}
        confirmLabel='Delete'
        onConfirm={async () => {
          await deleteWorkflow.mutateAsync({ workspaceId, workflowId })
          router.push(hrefFor(listHref(workspaceId, workflow?.folderId ?? undefined)))
        }}
      />
    </>
  )
}

/**
 * The legacy Run button and more menu: Run (Mod+Enter) or Stop, gated by the workspace's usage
 * limit as in legacy, then auto-layout, Variables and the workflow lock.
 */
export function WorkflowActions({ workspaceId, workflowId }: WorkflowHeaderProps) {
  const router = useRouter()
  const hrefFor = usePlatformHref()
  const scope = useSurfaceScope()
  const { billingEnabled } = useDeploymentShape()
  const { data: session } = useSession()
  const { data: hostContext } = useWorkspaceHostContextQuery(workspaceId)
  const { data: usageGate, isLoading: isUsageGateLoading } = useWorkspaceUsageGate(
    billingEnabled ? workspaceId : undefined
  )
  const usageExceeded = usageGate?.isExceeded ?? false
  const [requestingLimit, setRequestingLimit] = useState(false)

  const userPermissions = useUserPermissionsContext()
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const workflowLocked = isWorkflowEffectivelyLocked(workflows[workflowId] ?? null, folders)
  const canMutateWorkflow = userPermissions.canEdit && !workflowLocked
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const { handleAutoLayout } = useAutoLayout(activeWorkflowId || null, CANVAS_VIEWPORT_OPTIONS)
  const [isAutoLayouting, setIsAutoLayouting] = useState(false)
  const { hasBlocks, hasLockedBlocks, allBlocksLocked } = useWorkflowStore(
    useShallow((state) => {
      const blocks = Object.values(state.blocks)
      return {
        hasBlocks: blocks.length > 0,
        hasLockedBlocks: blocks.some((block) => block.locked),
        allBlocksLocked: blocks.length > 0 && blocks.every((block) => block.locked),
      }
    })
  )
  const { collaborativeBatchToggleLocked } = useCollaborativeWorkflow()
  const { isOpen: variablesOpen, setIsOpen: setVariablesOpen } = useVariablesModalStore(
    useShallow((state) => ({ isOpen: state.isOpen, setIsOpen: state.setIsOpen }))
  )
  const { handleRunWorkflow, handleCancelExecution, isExecuting } = useWorkflowExecution()

  const run = useCallback(async () => {
    if (isUsageGateLoading) return
    if (usageExceeded) {
      if (usageGate?.scope === 'member') {
        setRequestingLimit(true)
        return
      }
      if (!hostContext) return
      const action = getWorkspaceUsageLimitAction(hostContext, session?.user?.id, {
        message: usageGate?.message ?? null,
        scope: usageGate?.scope ?? null,
      })
      if (action.type === 'manage-billing')
        router.push(hrefFor(surfaceHref(scope, '/settings/billing')))
      else toast.error(action.message)
      return
    }
    await handleRunWorkflow()
  }, [
    isUsageGateLoading,
    usageExceeded,
    usageGate,
    hostContext,
    session?.user?.id,
    router,
    hrefFor,
    handleRunWorkflow,
  ])

  useRegisterGlobalCommands(() => [
    createCommand({
      id: 'run-workflow',
      handler: () => {
        if (isExecuting) void handleCancelExecution()
        else void run()
      },
      overrides: { allowInEditable: false },
    }),
  ])

  const autoLayout = useCallback(async () => {
    if (isExecuting || !canMutateWorkflow || isAutoLayouting) return
    setIsAutoLayouting(true)
    try {
      const result = await handleAutoLayout()
      if (!result.success && result.error) toast.error(result.error)
    } finally {
      setIsAutoLayouting(false)
    }
  }, [isExecuting, canMutateWorkflow, isAutoLayouting, handleAutoLayout])

  const toggleLock = useCallback(() => {
    const blocks = useWorkflowStore.getState().blocks
    const allLocked = Object.values(blocks).every((block) => block.locked)
    const ids = getWorkflowLockToggleIds(blocks, !allLocked)
    if (ids.length > 0) collaborativeBatchToggleLocked(ids)
  }, [collaborativeBatchToggleLocked])

  const menu = useMemo<MenuAction[]>(
    () => [
      {
        id: 'auto-layout',
        label: 'Auto layout',
        icon: 'I118',
        shortcut: '⇧L',
        disabled: isExecuting || !canMutateWorkflow || isAutoLayouting || hasLockedBlocks,
        disabledReason: hasLockedBlocks ? 'Unlock blocks to use auto-layout' : undefined,
        onSelect: () => void autoLayout(),
      },
      {
        id: 'variables',
        label: variablesOpen ? 'Hide variables' : 'Variables',
        icon: 'I050',
        onSelect: () => setVariablesOpen(!variablesOpen),
      },
      ...(userPermissions.canAdmin
        ? [
            {
              id: 'lock',
              label: allBlocksLocked ? 'Unlock workflow' : 'Lock workflow',
              icon: 'I136' as const,
              disabled: !hasBlocks || workflowLocked,
              disabledReason: workflowLocked
                ? 'Workflow is locked at the row or folder level — release it from the workflow notification or folder menu'
                : undefined,
              onSelect: toggleLock,
            },
          ]
        : []),
    ],
    [
      isExecuting,
      canMutateWorkflow,
      isAutoLayouting,
      hasLockedBlocks,
      autoLayout,
      variablesOpen,
      setVariablesOpen,
      userPermissions.canAdmin,
      allBlocksLocked,
      hasBlocks,
      workflowLocked,
      toggleLock,
    ]
  )

  const canRun = userPermissions.canRead
  const runDisabled =
    !isExecuting && (isUsageGateLoading || (!canRun && !userPermissions.isLoading))

  return (
    <>
      <ActionMenu label='Workflow actions' actions={menu} icon='I108' align='end' tooltip />
      <DeployButton workspaceId={workspaceId} workflowId={workflowId} />
      <Button
        size='compact'
        icon={isExecuting ? 'I035' : undefined}
        disabled={runDisabled}
        onClick={() => void (isExecuting ? handleCancelExecution() : run())}
      >
        {isExecuting ? 'Stop' : 'Run'}
      </Button>
      {requestingLimit && (
        <RequestAccessModal
          scope={{ kind: 'workspace', workspaceId }}
          target={{ kind: 'usage_limit', id: 'member' }}
          label='Credit limit'
          onViewRequest={(requestId) =>
            router.push(
              hrefFor(getMyAccessRequestHref({ kind: 'workspace', workspaceId }, requestId))
            )
          }
          onClose={() => setRequestingLimit(false)}
        />
      )}
    </>
  )
}
