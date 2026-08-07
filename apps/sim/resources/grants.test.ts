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
      manage: false,
      settled: true,
    })
  })

  it('lets a read-only member run', () => {
    expect(grantsFromPermissions({ canRead: true, canEdit: false, canAdmin: false })).toEqual({
      write: false,
      run: true,
      manage: false,
      settled: true,
    })
  })

  it('lets an editor run', () => {
    expect(grantsFromPermissions({ canRead: true, canEdit: true, canAdmin: false })).toEqual({
      write: true,
      run: true,
      manage: false,
      settled: true,
    })
  })

  it('never grants write without an edit permission', () => {
    for (const permissions of ALL_PERMISSIONS) {
      const grants = grantsFromPermissions(permissions)
      expect(grants.write).toBe(permissions.canEdit)
    }
  })

  it('grants manage exactly to an admin', () => {
    for (const permissions of ALL_PERMISSIONS) {
      expect(grantsFromPermissions(permissions).manage).toBe(permissions.canAdmin)
    }
  })

  /**
   * The distinction the field exists for. A resolving membership and a genuine
   * no-access member produce identical capability booleans, so without `settled`
   * a surface cannot tell "you may not" from "we do not know yet" — and both
   * disabled-during-load chrome and one-shot latched effects need to.
   */
  it('reports an unresolved membership as unsettled, with the same capabilities as a denied one', () => {
    const loading = grantsFromPermissions({
      canRead: false,
      canEdit: false,
      canAdmin: false,
      isLoading: true,
    })
    const denied = grantsFromPermissions({ canRead: false, canEdit: false, canAdmin: false })

    expect(loading.settled).toBe(false)
    expect(denied.settled).toBe(true)
    expect(loading.write).toBe(denied.write)
    expect(loading.run).toBe(denied.run)
    expect(loading.manage).toBe(denied.manage)
  })

  it('treats a caller that tracks no loading state as settled', () => {
    for (const permissions of ALL_PERMISSIONS) {
      expect(grantsFromPermissions(permissions).settled).toBe(true)
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

  it('never runs, for any kind', () => {
    for (const kind of RESOURCE_KINDS) {
      expect(grantsForShare(kind).run).toBe(false)
    }
  })

  it('never manages, for any kind', () => {
    for (const kind of RESOURCE_KINDS) {
      expect(grantsForShare(kind).manage).toBe(false)
    }
  })

  it('is always settled — a token resolves capabilities outright', () => {
    for (const kind of RESOURCE_KINDS) {
      expect(grantsForShare(kind).settled).toBe(true)
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
