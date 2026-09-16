import type { ScimPatchOperation } from '@/lib/api/contracts/scim'
import { readMemberValue } from '@/ee/scim/lib/protocol/canonical'
import { invalidPath, invalidValue, mutability, noTarget } from '@/ee/scim/lib/protocol/errors'
import { isRecord, normalizeAttributePath } from '@/ee/scim/lib/protocol/normalize'

/**
 * A parsed Group PATCH.
 *
 * Membership changes are separated from whole-resource writes because the
 * providers send far more of the former: an incremental sync that moves one
 * person between groups should touch two membership rows, not rewrite two full
 * member lists.
 */
export type GroupPatch =
  | { kind: 'incremental'; add: string[]; remove: string[] }
  | {
      kind: 'full'
      displayName?: string
      externalId?: string | null
      /** Replaces the whole membership when present. */
      members?: string[]
      /** Deltas that accompanied a rename in the same request. */
      addMembers: string[]
      removeMembers: string[]
    }

/** `members[value eq "id"]`, the removal form Okta and Entra's newer job send. */
const FILTERED_MEMBER_PATTERN =
  /^members\[\s*value\s+eq\s+(?<quote>"|')(?<value>[^"']+)\k<quote>\s*\]$/i

function readMemberList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value]
  const ids: string[] = []
  for (const entry of entries) {
    const id = readMemberValue(entry)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Reads a Group PATCH, choosing the incremental path when every operation is a
 * membership delta.
 */
export function parseGroupPatch(operations: readonly ScimPatchOperation[]): GroupPatch {
  const add: string[] = []
  const remove: string[] = []
  let incremental = true

  const full: Extract<GroupPatch, { kind: 'full' }> = {
    kind: 'full',
    addMembers: [],
    removeMembers: [],
  }

  /**
   * Membership is a set, so the final state of each member is decided by the
   * last operation naming them; an earlier delta is dropped when a later one
   * contradicts it, and a wholesale replace supersedes every delta before it.
   */
  const addMember = (id: string) => {
    const removedAt = remove.indexOf(id)
    if (removedAt !== -1) remove.splice(removedAt, 1)
    if (!add.includes(id)) add.push(id)
  }
  const removeMember = (id: string) => {
    const addedAt = add.indexOf(id)
    if (addedAt !== -1) add.splice(addedAt, 1)
    if (!remove.includes(id)) remove.push(id)
  }
  const applyFullMembers = (ids: string[]) => {
    incremental = false
    add.length = 0
    remove.length = 0
    full.members = ids
  }
  const readExternalId = (value: unknown): string | null => {
    if (typeof value !== 'string') throw invalidValue('externalId must be a string')
    return value.trim() || null
  }

  for (const operation of operations) {
    if (operation.op === 'remove' && !operation.path) {
      throw noTarget('A remove operation requires a path')
    }

    if (!operation.path) {
      const value = operation.value
      if (!isRecord(value)) {
        throw invalidValue('A PATCH operation without a path requires an object value')
      }
      incremental = false
      for (const [attribute, nested] of Object.entries(value)) {
        const key = normalizeAttributePath(attribute).toLowerCase()
        if (key === 'displayname') {
          if (typeof nested !== 'string' || !nested.trim()) {
            throw invalidValue('displayName must be a non-empty string')
          }
          full.displayName = nested.trim()
        } else if (key === 'externalid') {
          full.externalId = readExternalId(nested)
        } else if (key === 'members') {
          if (operation.op === 'add') for (const id of readMemberList(nested)) addMember(id)
          else applyFullMembers(readMemberList(nested))
        } else if (key === 'id' || key === 'schemas' || key.startsWith('meta')) {
          /**
           * Okta echoes the group's `id` inside a path-less rename. Read-only
           * attributes sent this way are ignored rather than refused, because
           * refusing would fail every Okta group rename.
           */
        } else {
          throw invalidPath(`Group PATCH path ${attribute} is not supported`)
        }
      }
      continue
    }

    const path = normalizeAttributePath(operation.path)
    const filtered = path.match(FILTERED_MEMBER_PATTERN)
    if (filtered?.groups) {
      if (operation.op !== 'remove') {
        throw invalidPath('A filtered members path is only supported for remove')
      }
      const id = filtered.groups.value.trim()
      if (id) removeMember(id)
      continue
    }

    const key = path.toLowerCase()
    if (key === 'members') {
      if (operation.op === 'replace') {
        /** Clearing a group is an explicit `[]` or a value-less remove, never a missing value. */
        if (operation.value === undefined || operation.value === null) {
          throw invalidValue('A replace of members requires a value')
        }
        applyFullMembers(readMemberList(operation.value))
        continue
      }
      if (operation.op === 'remove' && operation.value === undefined) {
        applyFullMembers([])
        continue
      }
      if (operation.op === 'add' && operation.value === undefined) {
        throw invalidValue('An add to members requires a value')
      }
      for (const id of readMemberList(operation.value ?? [])) {
        if (operation.op === 'add') addMember(id)
        else removeMember(id)
      }
      continue
    }

    if (key === 'displayname') {
      if (operation.op === 'remove') throw mutability('displayName cannot be removed')
      if (typeof operation.value !== 'string' || !operation.value.trim()) {
        throw invalidValue('displayName must be a non-empty string')
      }
      incremental = false
      full.displayName = operation.value.trim()
      continue
    }

    if (key === 'externalid') {
      incremental = false
      full.externalId = operation.op === 'remove' ? null : readExternalId(operation.value)
      continue
    }

    if (key === 'id' || key === 'schemas' || key.startsWith('meta')) {
      throw mutability(`${operation.path} is read-only`)
    }

    throw invalidPath(`Group PATCH path ${operation.path} is not supported`)
  }

  if (incremental) return { kind: 'incremental', add, remove }

  /**
   * A request that mixed a rename with membership deltas still has to apply
   * those deltas. They ride along so the caller resolves them against current
   * membership after any wholesale replacement in the same request.
   */
  full.addMembers = add
  full.removeMembers = remove
  return full
}
