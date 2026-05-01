'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import { getWorkflowStateContract } from '@/lib/api/contracts/workflows'
import { createWorkspaceContract } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { WorkspaceRecencyStorage } from '@/lib/core/utils/browser-storage'
import { useWorkspacesWithMetadata, type WorkspaceCreationPolicy } from '@/hooks/queries/workspace'

const logger = createLogger('WorkspacePage')

export default function WorkspacePage() {
  const router = useRouter()
  const { data: session, isPending: isSessionPending } = useSession()
  const isAuthenticated = !isSessionPending && !!session?.user
  const hasRedirectedRef = useRef(false)

  const { data, isLoading: isWorkspacesLoading } = useWorkspacesWithMetadata(isAuthenticated)

  useEffect(() => {
    if (isSessionPending || hasRedirectedRef.current) return

    if (!session?.user) {
      logger.info('User not authenticated, redirecting to login')
      router.replace('/login')
      return
    }

    if (isWorkspacesLoading || !data) return

    hasRedirectedRef.current = true

    const urlParams = new URLSearchParams(window.location.search)
    const redirectWorkflowId = urlParams.get('redirect_workflow')

    const { workspaces, lastActiveWorkspaceId, creationPolicy } = data

    if (workspaces.length === 0) {
      handleNoWorkspaces(router, creationPolicy)
      return
    }

    const localRecentId = WorkspaceRecencyStorage.getMostRecent()
    const findWorkspace = (id: string | null) =>
      id ? workspaces.find((w) => w.id === id) : undefined

    const targetWorkspace =
      findWorkspace(localRecentId) ?? findWorkspace(lastActiveWorkspaceId) ?? workspaces[0]

    if (redirectWorkflowId) {
      handleWorkflowRedirect(redirectWorkflowId, targetWorkspace.id, router)
      return
    }

    logger.info(`Redirecting to workspace: ${targetWorkspace.id}`)
    router.replace(`/workspace/${targetWorkspace.id}/home`)
  }, [session, isSessionPending, isWorkspacesLoading, data, router])

  if (isSessionPending || isWorkspacesLoading) {
    return (
      <div className='flex h-screen w-full items-center justify-center'>
        <div
          className='h-[18px] w-[18px] animate-spin rounded-full'
          style={{
            background:
              'conic-gradient(from 0deg, hsl(var(--muted-foreground)) 0deg 120deg, transparent 120deg 180deg, hsl(var(--muted-foreground)) 180deg 300deg, transparent 300deg 360deg)',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
            WebkitMask:
              'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
          }}
        />
      </div>
    )
  }

  return null
}

async function handleWorkflowRedirect(
  workflowId: string,
  fallbackWorkspaceId: string,
  router: ReturnType<typeof useRouter>
): Promise<void> {
  try {
    const workflowData = await requestJson(getWorkflowStateContract, {
      params: { id: workflowId },
    })
    const workspaceId = workflowData.data.workspaceId
    if (workspaceId) {
      logger.info(`Redirecting workflow ${workflowId} to workspace ${workspaceId}`)
      router.replace(`/workspace/${workspaceId}/w/${workflowId}`)
      return
    }
  } catch (error) {
    logger.error('Error fetching workflow for redirect:', error)
  }
  router.replace(`/workspace/${fallbackWorkspaceId}/home`)
}

async function handleNoWorkspaces(
  router: ReturnType<typeof useRouter>,
  creationPolicy: WorkspaceCreationPolicy | null
): Promise<void> {
  if (creationPolicy && !creationPolicy.canCreate) {
    logger.warn('No workspaces found and workspace creation is blocked', {
      reason: creationPolicy.reason,
      workspaceMode: creationPolicy.workspaceMode,
      organizationId: creationPolicy.organizationId,
    })
    router.replace('/')
    return
  }

  logger.warn('No workspaces found, creating default workspace')
  try {
    const data = await requestJson(createWorkspaceContract, {
      body: { name: 'My Workspace' },
    })
    if (data.workspace?.id) {
      logger.info(`Created default workspace: ${data.workspace.id}`)
      router.replace(`/workspace/${data.workspace.id}/home`)
      return
    }
    logger.error('Failed to create default workspace')
  } catch (error) {
    logger.error('Error creating default workspace:', error)
  }
  router.replace('/login')
}
