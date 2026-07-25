'use client'

import { useEffect, useRef, useState } from 'react'
import { Chip } from '@sim/emcn'
import { CircleAlert } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { getWorkflowStateContract } from '@/lib/api/contracts/workflows'
import { createWorkspaceContract } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { recoverFromStaleSession } from '@/lib/auth/stale-session-recovery'
import { WorkspaceRecencyStorage } from '@/lib/core/utils/browser-storage'
import { useWorkspacesWithMetadata, type WorkspaceCreationPolicy } from '@/hooks/queries/workspace'

const logger = createLogger('WorkspacePage')

/**
 * A 401 while the session claims we're authenticated means the auth cookies
 * are stale or inconsistent (e.g. after an impersonation session expired or
 * was switched). The only reliable recovery is a full sign-out, which clears
 * every auth cookie server-side — matching what "clear browser cache" did
 * manually — followed by a clean login.
 */
function isStaleSessionError(error: unknown): boolean {
  return isApiClientError(error) && error.status === 401
}

export default function WorkspacePage() {
  const router = useRouter()
  const { data: session, isPending: isSessionPending, error: sessionError } = useSession()
  const isAuthenticated = !isSessionPending && !!session?.user
  const hasRedirectedRef = useRef(false)
  const isRecoveringRef = useRef(false)
  const [recoveryFailed, setRecoveryFailed] = useState(false)

  const {
    data,
    isLoading: isWorkspacesLoading,
    error: workspacesError,
  } = useWorkspacesWithMetadata(isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated || !isStaleSessionError(workspacesError) || isRecoveringRef.current) return
    isRecoveringRef.current = true
    logger.warn('Session cookies are stale (authenticated session but 401 API); signing out')
    void recoverFromStaleSession().then((recovered) => {
      if (recovered) return
      isRecoveringRef.current = false
      setRecoveryFailed(true)
    })
  }, [isAuthenticated, workspacesError])

  useEffect(() => {
    if (isSessionPending || hasRedirectedRef.current) return

    if (!session?.user) {
      // Indeterminate auth (errored session query, no cached identity): show
      // the error card — /login would bounce back while a session cookie exists.
      if (sessionError) return
      // A clean null session can still have stale auth cookies behind it (an
      // expired impersonation session's cookies are never cleared server-side),
      // and the middleware bounces /login back here while any session cookie
      // exists — a bare replace('/login') loops forever on the spinner. Recover
      // the same way as the 401 path: sign out (clears the cookies without
      // needing a live session), then navigate.
      hasRedirectedRef.current = true
      logger.info('User not authenticated, signing out stale cookies and redirecting to login')
      void recoverFromStaleSession().then((recovered) => {
        if (!recovered) setRecoveryFailed(true)
      })
      return
    }

    if (isWorkspacesLoading || workspacesError || !data) return

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
  }, [session, isSessionPending, sessionError, isWorkspacesLoading, workspacesError, data, router])

  const failedToLoad =
    recoveryFailed ||
    (Boolean(sessionError) && !session?.user) ||
    (isAuthenticated && Boolean(workspacesError) && !isStaleSessionError(workspacesError))

  if (failedToLoad) {
    return (
      <main className='flex h-screen w-full items-center justify-center bg-[var(--surface-1)] p-6'>
        <div className='flex max-w-md flex-col items-center gap-3 text-center'>
          <div className='flex size-10 items-center justify-center rounded-full bg-[var(--surface-3)]'>
            <CircleAlert className='size-[18px] text-[var(--text-icon)]' aria-hidden />
          </div>
          <div className='space-y-1'>
            <h1 className='font-medium text-[var(--text-primary)] text-lg'>
              Could not load your workspaces
            </h1>
            <p className='text-[var(--text-muted)] text-sm'>
              Something went wrong while loading your account. Try again, or sign out and log back
              in.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Chip variant='primary' onClick={() => window.location.reload()}>
              Try again
            </Chip>
            <Chip onClick={() => void recoverFromStaleSession()}>Sign out</Chip>
          </div>
        </div>
      </main>
    )
  }

  return (
    <div className='flex h-screen w-full items-center justify-center'>
      <div
        className='size-[18px] animate-spin rounded-full'
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
