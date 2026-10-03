import type { PresenceUser } from '@/stores/presence/types'

/**
 * Folds a `presence-update` roster over the presence already held for each socket.
 *
 * The server rebuilds a socket's presence record from scratch when it joins a room, so a re-join
 * of the same workflow broadcasts a roster whose `cursor` and `selection` are simply absent. The
 * fields are carried over rather than blanked, which is what keeps a peer's pointer from
 * flickering on every re-join.
 *
 * A `null` `cursor` is therefore not the same as an absent one: it is a pointer the peer
 * explicitly cleared on leaving the canvas. Coalescing the two with `??` would resurrect a stale
 * pointer whenever the clearing `cursor-update` was missed — dropped by the visibility gate
 * during a join, or by a rejoin that never refreshed the roster. `selection` needs no such
 * split: a cleared selection is `{ type: 'none' }`, and the wire type admits no `null`.
 */
export function mergePresenceRoster(
  previous: PresenceUser[],
  incoming: PresenceUser[]
): PresenceUser[] {
  const previousBySocketId = new Map(previous.map((user) => [user.socketId, user]))

  return incoming.map((user) => {
    const existing = previousBySocketId.get(user.socketId)
    if (!existing) return user
    return {
      ...user,
      cursor: user.cursor === undefined ? existing.cursor : user.cursor,
      selection: user.selection ?? existing.selection,
    }
  })
}
