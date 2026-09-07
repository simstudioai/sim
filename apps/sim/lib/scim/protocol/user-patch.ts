import type { ScimUserAttributes, ScimUserEmail } from '@sim/db/schema'
import type { ScimPatchOperation } from '@/lib/api/contracts/scim'
import { invalidPath, invalidValue, mutability, noTarget } from '@/lib/scim/protocol/errors'
import {
  isRecord,
  normalizeAttributePath,
  normalizeScimBoolean,
  unwrapSingleElement,
} from '@/lib/scim/protocol/normalize'

/**
 * Applies a PATCH operation list to a stored User resource.
 *
 * Written here rather than taken from a library. The published SCIM patch
 * packages assume the RFC's wire shapes, and the two providers that matter do
 * not send them: Microsoft Entra capitalizes operation names, sends booleans as
 * strings, and identifies a member to remove by value alone where a library
 * compares the whole object. A patch engine that silently no-ops on a removal is
 * worse than one that refuses, because the directory records a success and stops
 * retrying.
 *
 * The attribute table is closed. An unrecognized path is an error, never a
 * silent drop, so a provider mapping an attribute Sim does not store learns it
 * on the first sync.
 */

export interface UserPatchOutcome {
  next: ScimUserAttributes
  changed: boolean
}

function clone(attributes: ScimUserAttributes): ScimUserAttributes {
  return structuredClone(attributes)
}

function requireString(value: unknown, attribute: string): string {
  const unwrapped = unwrapSingleElement(value)
  if (typeof unwrapped !== 'string') throw invalidValue(`${attribute} must be a string`)
  const trimmed = unwrapped.trim()
  if (!trimmed) throw invalidValue(`${attribute} must not be empty`)
  return trimmed
}

function requireBoolean(value: unknown, attribute: string): boolean {
  const normalized = normalizeScimBoolean(unwrapSingleElement(value))
  if (typeof normalized !== 'boolean') throw invalidValue(`${attribute} must be a boolean`)
  return normalized
}

/** Recomputes `formatted` and `displayName` after a name part changes. */
function refreshDerivedNames(user: ScimUserAttributes, fallback: string): void {
  const joined = [user.name.givenName, user.name.familyName].filter(Boolean).join(' ')
  if (joined) user.name.formatted = joined
  else if (!user.name.formatted) user.name.formatted = fallback
  if (!user.displayName) user.displayName = user.name.formatted
}

function setPrimaryEmailValue(user: ScimUserAttributes, value: string): void {
  const primary = user.emails.find((entry) => entry.primary)
  if (!primary) throw noTarget('The resource has no primary email address to replace')
  primary.value = value.toLowerCase()
}

function upsertTypedEmail(user: ScimUserAttributes, type: string, value: string): void {
  const existing = user.emails.find((entry) => entry.type?.toLowerCase() === type.toLowerCase())
  if (existing) {
    existing.value = value.toLowerCase()
    return
  }
  /**
   * Entra maps a work address to a filtered path and expects the target to be
   * created when the resource does not already carry one. RFC 7644 would answer
   * `noTarget`, and doing so fails the whole atomic PATCH over an attribute the
   * provider is trying to populate for the first time.
   */
  user.emails.push({ value: value.toLowerCase(), type, primary: user.emails.length === 0 })
}

function removeTypedEmail(user: ScimUserAttributes, type: string): void {
  const remaining = user.emails.filter((entry) => entry.type?.toLowerCase() !== type.toLowerCase())
  if (remaining.length === user.emails.length) return
  if (remaining.length === 0) throw invalidValue('A user must keep at least one email address')
  if (!remaining.some((entry) => entry.primary)) remaining[0].primary = true
  user.emails = remaining
}

function normalizeEmailList(value: unknown, attribute: string): ScimUserEmail[] {
  const entries = Array.isArray(value) ? value : [value]
  const normalized: ScimUserEmail[] = []
  for (const entry of entries) {
    if (!isRecord(entry)) throw invalidValue(`${attribute} entries must be objects`)
    const address = requireString(entry.value, `${attribute}.value`)
    normalized.push({
      value: address.toLowerCase(),
      ...(typeof entry.type === 'string' && entry.type.trim() ? { type: entry.type.trim() } : {}),
      primary: normalizeScimBoolean(entry.primary) === true,
    })
  }
  if (normalized.length === 0) throw invalidValue(`${attribute} must not be empty`)
  if (!normalized.some((entry) => entry.primary)) normalized[0].primary = true
  return normalized
}

/** `emails[type eq "work"].value` and the `primary eq true` variant Entra sends. */
const FILTERED_EMAIL_PATTERN =
  /^emails\[\s*(?<selector>type|primary)\s+eq\s+(?<quote>"|')?(?<match>[^"'\]]+)\k<quote>?\s*\]\.value$/i

function applyOperation(
  user: ScimUserAttributes,
  op: 'add' | 'replace' | 'remove',
  rawPath: string,
  value: unknown
): void {
  const path = normalizeAttributePath(rawPath)
  const key = path.toLowerCase()

  const filtered = path.match(FILTERED_EMAIL_PATTERN)
  if (filtered?.groups) {
    const { selector, match } = filtered.groups
    if (selector.toLowerCase() === 'primary') {
      if (normalizeScimBoolean(match) !== true) {
        throw invalidPath(`Unsupported User PATCH path ${rawPath}`)
      }
      if (op === 'remove') throw invalidValue('The primary email address cannot be removed')
      setPrimaryEmailValue(user, requireString(value, 'emails.value'))
      return
    }
    if (op === 'remove') removeTypedEmail(user, match)
    else upsertTypedEmail(user, match, requireString(value, 'emails.value'))
    return
  }

  switch (key) {
    case 'active':
      user.active = op === 'remove' ? true : requireBoolean(value, 'active')
      return

    case 'username':
      if (op === 'remove') throw mutability('userName cannot be removed')
      user.userName = requireString(value, 'userName').toLowerCase()
      return

    case 'externalid':
      if (op === 'remove') user.externalId = undefined
      else user.externalId = requireString(value, 'externalId')
      return

    case 'displayname':
      user.displayName = op === 'remove' ? user.name.formatted : requireString(value, 'displayName')
      return

    case 'name.formatted':
      if (op === 'remove') throw invalidValue('name.formatted cannot be removed')
      user.name.formatted = requireString(value, 'name.formatted')
      return

    case 'name.givenname':
      if (op === 'remove') user.name.givenName = undefined
      else user.name.givenName = requireString(value, 'name.givenName')
      refreshDerivedNames(user, user.userName)
      return

    case 'name.familyname':
      if (op === 'remove') user.name.familyName = undefined
      else user.name.familyName = requireString(value, 'name.familyName')
      refreshDerivedNames(user, user.userName)
      return

    case 'emails':
      if (op === 'remove') throw invalidValue('emails cannot be removed')
      if (op === 'replace') {
        user.emails = normalizeEmailList(value, 'emails')
        return
      }
      for (const entry of normalizeEmailList(value, 'emails')) {
        const existing = user.emails.find((candidate) => candidate.value === entry.value)
        if (existing) {
          if (entry.primary) {
            for (const candidate of user.emails) candidate.primary = false
            existing.primary = true
          }
          continue
        }
        if (entry.primary) for (const candidate of user.emails) candidate.primary = false
        user.emails.push(entry)
      }
      return

    case 'emails.value':
      if (op === 'remove') throw invalidValue('emails cannot be removed')
      setPrimaryEmailValue(user, requireString(value, 'emails.value'))
      return

    case 'enterprise.department':
    case 'enterprise.employeenumber':
    case 'enterprise.costcenter':
    case 'enterprise.division':
    case 'enterprise.organization': {
      const field = key.slice('enterprise.'.length)
      const attribute = (
        {
          department: 'department',
          employeenumber: 'employeeNumber',
          costcenter: 'costCenter',
          division: 'division',
          organization: 'organization',
        } as const
      )[field as 'department' | 'employeenumber' | 'costcenter' | 'division' | 'organization']
      user.enterprise ??= {}
      if (op === 'remove') user.enterprise[attribute] = undefined
      else user.enterprise[attribute] = requireString(value, `enterprise.${attribute}`)
      return
    }

    case 'enterprise.manager':
    case 'enterprise.manager.value': {
      user.enterprise ??= {}
      const unwrapped = unwrapSingleElement(value)
      /** Entra clears a manager by sending an empty string rather than removing. */
      if (op === 'remove' || unwrapped === '' || unwrapped === null) {
        user.enterprise.manager = undefined
        return
      }
      if (typeof unwrapped === 'string') {
        user.enterprise.manager = { value: unwrapped }
        return
      }
      if (isRecord(unwrapped)) {
        user.enterprise.manager = {
          ...(typeof unwrapped.value === 'string' ? { value: unwrapped.value } : {}),
          ...(typeof unwrapped.displayName === 'string'
            ? { displayName: unwrapped.displayName }
            : {}),
        }
        return
      }
      throw invalidValue('enterprise manager must be an identifier or an object')
    }

    case 'id':
    case 'schemas':
      throw mutability(`${rawPath} is read-only`)

    default:
      if (key.startsWith('meta')) throw mutability(`${rawPath} is read-only`)
      throw invalidPath(`User PATCH path ${rawPath} is not supported`)
  }
}

/**
 * Sorts object keys at every depth so serialization is order-independent.
 *
 * Cleared attributes are set to `undefined` rather than deleted, and
 * `JSON.stringify` drops those, so a cleared attribute compares equal to an
 * absent one — which is what it means on the wire and in storage.
 */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (!isRecord(value)) return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) sorted[key] = sortDeep(value[key])
  return sorted
}

/**
 * Canonical form used only to decide whether a patch changed anything.
 *
 * Key order in the stored JSON is not meaningful, so comparing serialized
 * objects directly would report a change whenever a provider reordered its
 * attributes — and every such false positive is a write, an audit row, and a
 * projection pass that did nothing.
 */
function comparisonKey(attributes: ScimUserAttributes): string {
  return JSON.stringify(sortDeep(attributes))
}

/** Whether two canonical resources describe the same state, ignoring key order. */
export function userAttributesEqual(left: ScimUserAttributes, right: ScimUserAttributes): boolean {
  return comparisonKey(left) === comparisonKey(right)
}

export function applyUserPatch(
  current: ScimUserAttributes,
  operations: readonly ScimPatchOperation[]
): UserPatchOutcome {
  const next = clone(current)

  for (const operation of operations) {
    if (operation.op === 'remove' && !operation.path) {
      throw noTarget('A remove operation requires a path')
    }

    if (!operation.path) {
      const value = operation.value
      if (!isRecord(value)) {
        throw invalidValue('A PATCH operation without a path requires an object value')
      }
      /**
       * Entra's compliant mode sends one path-less replace whose value object is
       * keyed by dotted attribute paths, so each key is dispatched as if it had
       * arrived as its own operation.
       */
      for (const [attribute, nested] of Object.entries(value)) {
        applyOperation(next, operation.op, attribute, nested)
      }
      continue
    }

    applyOperation(next, operation.op, operation.path, operation.value)
  }

  return { next, changed: comparisonKey(current) !== comparisonKey(next) }
}
