import { describe, expect, it } from 'vitest'
import { parseRoomName, ROOM_TYPES, type RoomRef, roomName } from './rooms'

describe('roomName', () => {
  it('never collides a namespaced room with a bare workflow id for real ids', () => {
    // Room ids in Sim are opaque tokens without a colon (UUIDs / short ids), so a
    // bare workflow id can never look like a `${type}:${id}` namespaced name.
    const workflow = roomName({ type: ROOM_TYPES.WORKFLOW, id: 'a1b2c3d4-uuid' })
    const files = roomName({ type: ROOM_TYPES.WORKSPACE_FILES, id: 'a1b2c3d4-uuid' })
    expect(workflow).not.toBe(files)
    expect(workflow.includes(':')).toBe(false)
  })
})

describe('parseRoomName', () => {
  it('round-trips every room type through roomName', () => {
    const refs: RoomRef[] = [
      { type: ROOM_TYPES.WORKFLOW, id: 'wf-123' },
      { type: ROOM_TYPES.WORKSPACE_FILES, id: 'ws-456' },
      { type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: 'file-789' },
      { type: ROOM_TYPES.TABLE, id: 'table-abc' },
    ]
    for (const ref of refs) {
      expect(parseRoomName(roomName(ref))).toEqual(ref)
    }
  })

  it('preserves ids that themselves contain colons', () => {
    expect(parseRoomName('workspace-files:a:b:c')).toEqual({
      type: ROOM_TYPES.WORKSPACE_FILES,
      id: 'a:b:c',
    })
  })
})
