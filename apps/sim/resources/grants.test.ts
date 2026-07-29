/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  grantsForShare,
  grantsFromPermissions,
  RESOURCE_KINDS,
  type WorkspacePermissionSnapshot,
} from '@/resources'

const BOOLEANS = [false, true] as const

/** Every reachable permission combination, so invariants are checked exhaustively. */
const ALL_PERMISSIONS: readonly WorkspacePermissionSnapshot[] = BOOLEANS.flatMap((canRead) =>
  BOOLEANS.flatMap((canEdit) => BOOLEANS.map((canAdmin) => ({ canRead, canEdit, canAdmin })))
)

describe('grantsFromPermissions', () => {
  it('grants nothing outside a workspace membership', () => {
    expect(grantsFromPermissions({ canRead: false, canEdit: false, canAdmin: false })).toEqual({
      write: false,
      run: false,
    })
  })

  it('lets a read-only member run', () => {
    expect(grantsFromPermissions({ canRead: true, canEdit: false, canAdmin: false })).toEqual({
      write: false,
      run: true,
    })
  })

  it('lets an editor run', () => {
    expect(grantsFromPermissions({ canRead: true, canEdit: true, canAdmin: false })).toEqual({
      write: true,
      run: true,
    })
  })

  it('never grants write without an edit permission', () => {
    for (const permissions of ALL_PERMISSIONS) {
      const grants = grantsFromPermissions(permissions)
      expect(grants.write).toBe(permissions.canEdit)
    }
  })

  it('never runs anything without at least read', () => {
    for (const permissions of ALL_PERMISSIONS) {
      if (permissions.canRead || permissions.canEdit) continue
      expect(grantsFromPermissions(permissions).run).toBe(false)
    }
  })
})

describe('grantsForShare', () => {
  it('never writes, for any kind', () => {
    for (const kind of RESOURCE_KINDS) {
      expect(grantsForShare(kind).write).toBe(false)
    }
  })

  it('runs only for a shared interface', () => {
    expect(grantsForShare('interface').run).toBe(true)
    for (const kind of RESOURCE_KINDS) {
      if (kind === 'interface') continue
      expect(grantsForShare(kind).run).toBe(false)
    }
  })

  it('is never more capable than a read-only member', () => {
    const member = grantsFromPermissions({ canRead: true, canEdit: false, canAdmin: false })
    for (const kind of RESOURCE_KINDS) {
      const grants = grantsForShare(kind)
      expect(grants.write).toBe(false)
      expect(!grants.run || member.run).toBe(true)
    }
  })
})
