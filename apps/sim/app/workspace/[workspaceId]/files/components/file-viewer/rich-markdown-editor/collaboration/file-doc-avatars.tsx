'use client'

import { useFileDocOthers } from '@/components/file-viewer/rich-markdown-editor/collaboration/file-doc-room-context'
import { PresenceAvatars } from '@/components/presence/presence-avatars'

/**
 * Avatar stack of the collaborators currently in the open file — the `useOthers` avatar
 * stack, reading the room roster from {@link useFileDocOthers}. Renders nothing until
 * someone else joins. Must sit inside a `FileDocRoomProvider`.
 */
export function FileDocAvatars() {
  const others = useFileDocOthers()
  return <PresenceAvatars users={others} className='mr-1' />
}
