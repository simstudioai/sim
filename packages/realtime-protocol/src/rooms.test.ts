import { describe, expect, it } from 'vitest'
import {
  ALL_ROOM_TYPES,
  isRoomType,
  isSameRoom,
  parseRoomName,
  ROOM_TYPES,
  type RoomRef,
  roomName,
} from './rooms'

describe('roomName', () => {
  it('maps a workflow room to its bare id (backward compatibility)', () => {
    expect(roomName({ type: ROOM_TYPES.WORKFLOW, id: 'wf-123' })).toBe('wf-123')
  })

  it('namespaces every non-workflow room type', () => {
    expect(roomName({ type: ROOM_TYPES.WORKSPACE_FILES, id: 'ws-123' })).toBe(
      'workspace-files:ws-123'
    )
    expect(roomName({ type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: 'file-123' })).toBe(
      'workspace-file-doc:file-123'
    )
  })

  it('keeps the file-doc and file-browser namespaces distinct for the same id', () => {
    // `workspace-file-doc` must not be parsed as the `workspace-files` browser
    // room (or vice versa): the prefix match is the whole segment before `:`.
    const id = 'a1b2c3d4-uuid'
    const doc = roomName({ type: ROOM_TYPES.WORKSPACE_FILE_DOC, id })
    const browser = roomName({ type: ROOM_TYPES.WORKSPACE_FILES, id })
    expect(doc).not.toBe(browser)
    expect(parseRoomName(doc)).toEqual({ type: ROOM_TYPES.WORKSPACE_FILE_DOC, id })
    expect(parseRoomName(browser)).toEqual({ type: ROOM_TYPES.WORKSPACE_FILES, id })
  })

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
    ]
    for (const ref of refs) {
      expect(parseRoomName(roomName(ref))).toEqual(ref)
    }
  })

  it('treats an unprefixed name as a workflow room', () => {
    expect(parseRoomName('bare-uuid')).toEqual({ type: ROOM_TYPES.WORKFLOW, id: 'bare-uuid' })
  })

  it('preserves ids that themselves contain colons', () => {
    expect(parseRoomName('workspace-files:a:b:c')).toEqual({
      type: ROOM_TYPES.WORKSPACE_FILES,
      id: 'a:b:c',
    })
  })

  it('does not treat an unknown prefix as a room type', () => {
    expect(parseRoomName('unknown:x')).toEqual({ type: ROOM_TYPES.WORKFLOW, id: 'unknown:x' })
  })

  it('returns null for the empty string', () => {
    expect(parseRoomName('')).toBeNull()
  })
})

describe('isRoomType', () => {
  it('accepts known types and rejects others', () => {
    expect(isRoomType(ROOM_TYPES.WORKFLOW)).toBe(true)
    expect(isRoomType(ROOM_TYPES.WORKSPACE_FILES)).toBe(true)
    expect(isRoomType('nope')).toBe(false)
  })
})

describe('isSameRoom', () => {
  it('compares by type and id', () => {
    const a: RoomRef = { type: ROOM_TYPES.WORKSPACE_FILES, id: 'ws-1' }
    expect(isSameRoom(a, { ...a })).toBe(true)
    expect(isSameRoom(a, { type: ROOM_TYPES.WORKFLOW, id: 'ws-1' })).toBe(false)
    expect(isSameRoom(a, { type: ROOM_TYPES.WORKSPACE_FILES, id: 'ws-2' })).toBe(false)
  })
})

describe('ALL_ROOM_TYPES', () => {
  it('contains every declared room type', () => {
    expect([...ALL_ROOM_TYPES].sort()).toEqual([...Object.values(ROOM_TYPES)].sort())
  })
})
