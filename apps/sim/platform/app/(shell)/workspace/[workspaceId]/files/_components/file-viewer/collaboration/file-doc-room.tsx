'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import { AvatarGroup } from '@sim/emcn/avatar'

/** A collaborator in the open file, from the server-authenticated roster. */
export interface FileDocPeer {
  userId: string
  userName: string
  avatarUrl: string | null
}

const EMPTY_PEERS: FileDocPeer[] = []
const noop = () => {}

/**
 * Two contexts: the roster changes on every join and leave, while its setter never does, so the
 * editor that reports the roster never re-renders for it; only the avatar stack reads it.
 */
const FileDocPeersContext = createContext<FileDocPeer[]>(EMPTY_PEERS)
const FileDocSetPeersContext = createContext<(peers: FileDocPeer[]) => void>(noop)

/**
 * Scopes "who's in this file" to the open document. The editor owns the collaboration session but
 * sits below the control bar that shows the avatars, so it publishes the roster here.
 */
export function FileDocRoomProvider({ children }: { children: ReactNode }) {
  const [peers, setPeers] = useState<FileDocPeer[]>(EMPTY_PEERS)
  return (
    <FileDocSetPeersContext.Provider value={setPeers}>
      <FileDocPeersContext.Provider value={peers}>{children}</FileDocPeersContext.Provider>
    </FileDocSetPeersContext.Provider>
  )
}

/** Publishes the roster from the editor; a no-op outside a room. */
export function useReportFileDocPeers(): (peers: FileDocPeer[]) => void {
  return useContext(FileDocSetPeersContext)
}

/** The collaborators in the open file, other than this session; nothing until someone joins. */
export function FileDocAvatars() {
  const peers = useContext(FileDocPeersContext)
  if (peers.length === 0) return null
  return (
    <AvatarGroup
      label='People in this file'
      people={peers.map((peer) => ({ name: peer.userName, src: peer.avatarUrl ?? undefined }))}
    />
  )
}
