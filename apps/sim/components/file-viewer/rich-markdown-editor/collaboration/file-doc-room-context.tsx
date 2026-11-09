'use client'

import { createContext, useContext } from 'react'
import type { PresenceAvatarUser } from '@/components/presence/presence-avatars'

const noop = () => {}

const FileDocSetOthersContext = createContext<(users: PresenceAvatarUser[]) => void>(noop)

/** Publishes the server roster into the room context (editor side). Returns a stable no-op
 *  outside a room provider. */
export function useReportFileDocOthers(): (users: PresenceAvatarUser[]) => void {
  return useContext(FileDocSetOthersContext)
}
