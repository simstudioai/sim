'use client'

import { PresenceAvatars } from '@/app/workspace/[workspaceId]/components/presence/presence-avatars'
import { useFileDocOthers } from './file-doc-room-context'

/**
 * Avatar stack of the collaborators currently in the open file — the `useOthers` avatar
 * stack, reading the room roster from {@link useFileDocOthers}. Renders nothing until
 * someone else joins. Must sit inside a `FileDocRoomProvider`.
 */
export function FileDocAvatars() {
  const others = useFileDocOthers()
  return <PresenceAvatars users={others} className='mr-1' />
}
