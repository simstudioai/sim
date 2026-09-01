'use client'

import { useMemo } from 'react'
import { PresenceAvatars } from '@/app/workspace/[workspaceId]/components/presence/presence-avatars'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { usePresenceStore } from '@/stores/presence/store'
import { useSidebarStore } from '@/stores/sidebar/store'

/**
 * Avatar display configuration for responsive layout.
 */
const AVATAR_CONFIG = {
  MIN_COUNT: 4,
  MAX_COUNT: 12,
  WIDTH_PER_AVATAR: 20,
} as const

interface AvatarsProps {
  workflowId: string
}

/**
 * Presence avatars for a workflow sidebar item. Owns the workflow-specific
 * concerns — the presence source, the current-workflow filter, and the
 * sidebar-width-driven visible count — and delegates the stack rendering to the
 * shared {@link PresenceAvatars}, so it looks identical to every other surface.
 */
export function Avatars({ workflowId }: AvatarsProps) {
  const { currentWorkflowId, currentSocketId } = useSocket()
  const presenceUsers = usePresenceStore((state) => state.presenceUsers)
  const sidebarWidth = useSidebarStore((state) => state.sidebarWidth)

  /**
   * Scale the max visible avatars between MIN_COUNT and MAX_COUNT as the sidebar
   * widens.
   */
  const maxVisible = useMemo(() => {
    const widthDelta = sidebarWidth - SIDEBAR_WIDTH.MIN
    const additionalAvatars = Math.floor(widthDelta / AVATAR_CONFIG.WIDTH_PER_AVATAR)
    const calculated = AVATAR_CONFIG.MIN_COUNT + additionalAvatars
    return Math.max(AVATAR_CONFIG.MIN_COUNT, Math.min(AVATAR_CONFIG.MAX_COUNT, calculated))
  }, [sidebarWidth])

  /**
   * Only show presence for the currently active workflow, excluding the current
   * socket (so the user's own other tabs still appear).
   */
  const workflowUsers = useMemo(() => {
    if (currentWorkflowId !== workflowId) return []
    return presenceUsers.filter((user) => user.socketId !== currentSocketId)
  }, [presenceUsers, currentWorkflowId, workflowId, currentSocketId])

  return <PresenceAvatars users={workflowUsers} maxVisible={maxVisible} />
}
