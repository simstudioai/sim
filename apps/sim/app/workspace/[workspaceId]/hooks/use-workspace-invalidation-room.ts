'use client'

import type { RoomType } from '@sim/realtime-protocol/rooms'
import { useInvalidationRoom } from '@/hooks/use-invalidation-room'

/** Workspace list consumers retain their existing event names, payloads, and query callbacks. */
export function useWorkspaceInvalidationRoom(
  workspaceId: string,
  roomType: RoomType,
  onChanged: () => void,
  dedupeKey?: string
): void {
  useInvalidationRoom({ ownerId: workspaceId, roomType, onChanged, dedupeKey })
}
