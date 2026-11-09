'use client'

import { useEffect } from 'react'
import { useSession } from '@/lib/auth/client'
import { useRecordWorkspaceVisit } from '@/hooks/queries/workspace'

/**
 * Records the viewer's visit each time a live workspace opens, as the legacy workspace layout did,
 * so the workspace list orders by the viewer's visits. It waits for the session, then moves the
 * workspace to the front of the cached list at once.
 */
export function WorkspaceVisit({ workspaceId }: { workspaceId: string }) {
  const viewerId = useSession().data?.user?.id
  const { mutate: recordVisit } = useRecordWorkspaceVisit()
  useEffect(() => {
    if (viewerId) recordVisit(workspaceId)
  }, [workspaceId, viewerId, recordVisit])
  return null
}
