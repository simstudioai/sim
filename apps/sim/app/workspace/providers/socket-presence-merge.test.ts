import { describe, expect, it } from 'vitest'
import { mergePresenceRoster } from '@/app/workspace/providers/socket-presence-merge'
import type { PresenceUser } from '@/stores/presence/types'

function peer(overrides: Partial<PresenceUser> = {}): PresenceUser {
  return {
    socketId: 'socket-1',
    userId: 'user-1',
    userName: 'Ada',
    ...overrides,
  }
}

describe('mergePresenceRoster', () => {
  it('clears the pointer when the roster carries an explicit null cursor', () => {
    const previous = [peer({ cursor: { x: 10, y: 20 } })]

    const merged = mergePresenceRoster(previous, [peer({ cursor: null })])

    expect(merged[0].cursor).toBeNull()
  })

  it('keeps the known pointer when the roster omits the cursor', () => {
    const previous = [peer({ cursor: { x: 10, y: 20 } })]

    const merged = mergePresenceRoster(previous, [peer()])

    expect(merged[0].cursor).toEqual({ x: 10, y: 20 })
  })

  it('keeps the known selection when the roster omits it', () => {
    const previous = [peer({ selection: { type: 'block', id: 'block-1' } })]

    const merged = mergePresenceRoster(previous, [peer()])

    expect(merged[0].selection).toEqual({ type: 'block', id: 'block-1' })
  })

  it('applies a cleared selection, which the wire spells as type none', () => {
    const previous = [peer({ selection: { type: 'block', id: 'block-1' } })]

    const merged = mergePresenceRoster(previous, [peer({ selection: { type: 'none' } })])

    expect(merged[0].selection).toEqual({ type: 'none' })
  })

  it('passes through a peer it has no previous presence for', () => {
    const joining = peer({ socketId: 'socket-2', userId: 'user-2', cursor: { x: 1, y: 2 } })

    expect(mergePresenceRoster([], [joining])).toEqual([joining])
  })

  it('drops peers the roster no longer lists', () => {
    const previous = [peer(), peer({ socketId: 'socket-2', userId: 'user-2' })]

    const merged = mergePresenceRoster(previous, [peer()])

    expect(merged.map((user) => user.socketId)).toEqual(['socket-1'])
  })
})
