'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import { toast } from '@/lib/toast/sink'
import {
  useCreateWorkspace,
  useToggleWorkspacePin,
  useUpdateWorkspace,
} from '@/hooks/queries/workspace'
import type { ShellWorkspaceActions } from '@/platform/app/(shell)/_components/model'

const logger = createLogger('PlatformWorkspaces')

/** Bounds the one reload after a creation that raced an organization membership change. */
const WORKSPACE_RACE_RETRY_KEY = 'workspaceRaceRetry'

/** The legacy sidebar's workspace mutations. `hrefFor` names where a workspace opens. */
export function useWorkspaceActions(
  hrefFor: (workspaceId: string) => string
): Omit<ShellWorkspaceActions, 'retry'> {
  const { mutateAsync: createWorkspace } = useCreateWorkspace()
  const { mutateAsync: updateWorkspace } = useUpdateWorkspace()
  const { mutate: togglePin } = useToggleWorkspacePin()
  return {
    async create(name) {
      const workspace = await createWorkspace({ name })
      return hrefFor(workspace.id)
    },
    async rename(workspaceId, name) {
      await updateWorkspace({ workspaceId, name })
    },
    setPinned: (workspaceId, pinned) =>
      togglePin({ workspaceId, pinned }, { onError: (error) => void toast.error(error.message) }),
  }
}

/**
 * The legacy entry's first workspace: created once for a viewer who has none, after which the
 * server entry opens it. A conflict means their organization membership changed while it was being
 * created, so their workspaces likely exist now: reload once to re-resolve, and report a second.
 */
export function useFirstWorkspace() {
  const router = useRouter()
  const { mutateAsync: createWorkspace } = useCreateWorkspace()
  const [failed, setFailed] = useState(false)
  const started = useRef(false)
  const create = async () => {
    try {
      await createWorkspace({ name: 'My Workspace' })
      sessionStorage.removeItem(WORKSPACE_RACE_RETRY_KEY)
      router.refresh()
    } catch (error) {
      if (isApiClientError(error) && error.status === 409) {
        if (!sessionStorage.getItem(WORKSPACE_RACE_RETRY_KEY)) {
          sessionStorage.setItem(WORKSPACE_RACE_RETRY_KEY, '1')
          window.location.reload()
          return
        }
        sessionStorage.removeItem(WORKSPACE_RACE_RETRY_KEY)
      }
      logger.error('Could not create the first workspace', { error })
      setFailed(true)
    }
  }
  const createOnce = useRef(create)
  createOnce.current = create
  useEffect(() => {
    if (started.current) return
    started.current = true
    void createOnce.current()
  }, [])
  return {
    failed,
    retry: () => {
      setFailed(false)
      void create()
    },
  }
}
