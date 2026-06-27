/**
 * A collaborator present in the active workflow room. Mirrors the presence
 * payload broadcast by the realtime server (`presence-update`, cursor/selection
 * deltas, and `join-workflow-success`).
 */
export interface PresenceUser {
  socketId: string
  userId: string
  userName: string
  avatarUrl?: string | null
  cursor?: { x: number; y: number } | null
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
}

export interface PresenceState {
  presenceUsers: PresenceUser[]
  /** Replace the full presence list (join success, presence-update). */
  setPresenceUsers: (users: PresenceUser[]) => void
  /** Apply a functional update to the presence list (cursor/selection deltas). */
  updatePresenceUsers: (updater: (prev: PresenceUser[]) => PresenceUser[]) => void
  /** Clear presence when leaving or losing the workflow room. */
  clearPresenceUsers: () => void
}
