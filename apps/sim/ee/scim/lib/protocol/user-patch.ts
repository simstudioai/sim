import type { ScimUserAttributes, ScimUserEmail } from '@sim/db/schema'
import type { ScimPatchOperation } from '@/lib/api/contracts/scim'
import { invalidPath, invalidValue, mutability, noTarget } from '@/ee/scim/lib/protocol/errors'
import {
  isRecord,
  isScimPasswordAttribute,
  normalizeAttributePath,
  normalizeScimBoolean,
  unwrapSingleElement,
} from '@/ee/scim/lib/protocol/normalize'

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
 * Attributes Sim models are applied to the fields it reads; every other
 * attribute is kept under `extra`, exactly as a create or replace keeps it, so
 * a directory's own attribute mappings round-trip through PATCH as well. Only
 * server-owned attributes (`id`, `schemas`, `meta`) are refused.
 */

export interface UserPatchOutcome {
  next: ScimUserAttributes
  changed: boolean
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

/** Recomputes the formatted name without overwriting an explicit display name. */
function refreshFormattedName(user: ScimUserAttributes, fallback: string): void {
  const joined = [user.name.givenName, user.name.familyName].filter(Boolean).join(' ')
  if (joined) user.name.formatted = joined
  else if (!user.name.formatted) user.name.formatted = fallback
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

function normalizeEmailList(
  value: unknown,
  attribute: string,
  options: { defaultPrimary: boolean }
): ScimUserEmail[] {
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
  /** A whole list needs a primary; an added address stays secondary unless it says otherwise. */
  if (options.defaultPrimary && !normalized.some((entry) => entry.primary)) {
    normalized[0].primary = true
  }
  return normalized
}

/** `emails[type eq "work"].value` and the `primary eq true` variant Entra sends. */
const FILTERED_EMAIL_PATTERN =
  /^emails\[\s*(?<selector>type|primary)\s+eq\s+(?<quote>"|')?(?<match>[^"'\]]+)\k<quote>?\s*\]\.value$/i

function applyOperation(
  user: ScimUserAttributes,
  op: 'add' | 'replace' | 'remove',
  rawPath: string,
  value: unknown,
  resourceAttribute = false
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
    case 'password':
      return

    case 'name':
    case 'enterprise': {
      if (op === 'remove') {
        if (key === 'name') user.name = { formatted: user.userName }
        else user.enterprise = undefined
        return
      }
      if (!isRecord(value)) throw invalidValue(`${path} requires an object value`)
      for (const [sub, nested] of sortFormattedLast(Object.entries(value))) {
        applyOperation(user, op, `${path}.${sub}`, nested)
      }
      return
    }

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
      if (op === 'remove') {
        user.displayName = undefined
        user.displayNameSource = undefined
      } else {
        user.displayName = requireString(value, 'displayName')
        user.displayNameSource = 'provider'
      }
      return

    case 'name.formatted':
      if (op === 'remove') throw invalidValue('name.formatted cannot be removed')
      user.name.formatted = requireString(value, 'name.formatted')
      return

    case 'name.givenname':
      if (op === 'remove') user.name.givenName = undefined
      else user.name.givenName = requireString(value, 'name.givenName')
      refreshFormattedName(user, user.userName)
      return

    case 'name.familyname':
      if (op === 'remove') user.name.familyName = undefined
      else user.name.familyName = requireString(value, 'name.familyName')
      refreshFormattedName(user, user.userName)
      return

    case 'emails':
      if (op === 'remove') throw invalidValue('emails cannot be removed')
      if (op === 'replace') {
        user.emails = normalizeEmailList(value, 'emails', { defaultPrimary: true })
        return
      }
      for (const entry of normalizeEmailList(value, 'emails', { defaultPrimary: false })) {
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
      applyExtraOperation(user, op, path, value, resourceAttribute)
  }
}

/** `attr`, `attr.sub`, or `attr[type eq "x"].sub` on an attribute Sim does not model. */
const EXTRA_PATH_PATTERN =
  /^(?<attribute>[A-Za-z][\w-]*)(?:\[\s*type\s+eq\s+(?<quote>"|')?(?<type>[^"'\]]+)\k<quote>?\s*\])?(?:\.(?<sub>[A-Za-z][\w-]*))?$/i

/** Uses the resource's schema keys to distinguish an extension from one of its attributes. */
function extensionTarget(
  extra: Record<string, unknown>,
  path: string,
  resourceAttribute: boolean,
  value: unknown
): { schema: string; attribute?: string } | undefined {
  if (!path.toLowerCase().startsWith('urn:')) return undefined
  const lowered = path.toLowerCase()
  const existing = Object.keys(extra)
    .filter(
      (schema) =>
        schema.toLowerCase().startsWith('urn:') &&
        (lowered === schema.toLowerCase() || lowered.startsWith(`${schema.toLowerCase()}:`))
    )
    .sort((left, right) => right.length - left.length)[0]
  if (existing) {
    return {
      schema: existing,
      ...(path.length > existing.length ? { attribute: path.slice(existing.length + 1) } : {}),
    }
  }
  if (resourceAttribute && isRecord(value)) return { schema: path }
  const separator = path.lastIndexOf(':')
  if (separator <= 'urn:'.length) throw invalidPath(`User PATCH path ${path} is not supported`)
  return { schema: path.slice(0, separator), attribute: path.slice(separator + 1) }
}

/**
 * Applies an operation to an attribute Sim does not model.
 *
 * A create or replace keeps every attribute the directory sends under `extra`
 * so responses round-trip them; a patch must do the same, or Entra's default
 * mappings — `title`, `preferredLanguage`, work phone and address — would fail
 * every update as a whole, since a PATCH is atomic. The stored shape is the
 * wire shape: a plain value, a nested object, or a typed multi-valued list.
 */
function applyExtraOperation(
  user: ScimUserAttributes,
  op: 'add' | 'replace' | 'remove',
  path: string,
  value: unknown,
  resourceAttribute: boolean
): void {
  user.extra ??= {}
  const extension = extensionTarget(user.extra, path, resourceAttribute, value)
  if (extension) {
    if (!extension.attribute) {
      if (op === 'remove') delete user.extra[extension.schema]
      else {
        if (!isRecord(value)) throw invalidValue(`${path} requires an object value`)
        const current = user.extra[extension.schema]
        user.extra[extension.schema] = { ...(isRecord(current) ? current : {}), ...value }
      }
      return
    }
    const current = user.extra[extension.schema]
    const attributes = isRecord(current) ? { ...current } : {}
    applyExtraAttribute(attributes, op, extension.attribute, value)
    user.extra[extension.schema] = attributes
    return
  }
  applyExtraAttribute(user.extra, op, path, value)
}

/** Applies a simple or typed complex path inside either the core resource or an extension. */
function applyExtraAttribute(
  attributes: Record<string, unknown>,
  op: 'add' | 'replace' | 'remove',
  path: string,
  value: unknown
): void {
  const match = path.match(EXTRA_PATH_PATTERN)
  if (!match?.groups) throw invalidPath(`User PATCH path ${path} is not supported`)
  const { type, sub } = match.groups
  const attribute =
    Object.keys(attributes).find(
      (key) => key.toLowerCase() === match.groups?.attribute.toLowerCase()
    ) ?? match.groups.attribute

  if (!type && !sub) {
    if (op === 'remove') attributes[attribute] = undefined
    else attributes[attribute] = value
    return
  }

  if (type) {
    const list = Array.isArray(attributes[attribute]) ? [...attributes[attribute]] : []
    const index = list.findIndex(
      (entry) => isRecord(entry) && String(entry.type).toLowerCase() === type.toLowerCase()
    )
    if (op === 'remove' && !sub) {
      if (index !== -1) list.splice(index, 1)
    } else if (sub) {
      if (op === 'remove' && index === -1) return
      const current = index !== -1 && isRecord(list[index]) ? list[index] : { type }
      const key = Object.keys(current).find((key) => key.toLowerCase() === sub.toLowerCase()) ?? sub
      const next = { ...current, [key]: op === 'remove' ? undefined : value }
      if (index === -1) list.push(next)
      else list[index] = next
    } else if (isRecord(value)) {
      if (index === -1) list.push({ type, ...value })
      else list[index] = { ...(list[index] as Record<string, unknown>), ...value }
    } else {
      throw invalidValue(`${path} requires an object value`)
    }
    attributes[attribute] = list
    return
  }

  const current = isRecord(attributes[attribute]) ? { ...attributes[attribute] } : {}
  const key = Object.keys(current).find((key) => key.toLowerCase() === sub.toLowerCase()) ?? sub
  current[key] = op === 'remove' ? undefined : value
  attributes[attribute] = current
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

/**
 * Orders `name.formatted` after the name parts it would otherwise be derived
 * from, so an explicit formatted name wins regardless of JSON property order.
 */
function sortFormattedLast(entries: [string, unknown][]): [string, unknown][] {
  const isFormatted = ([key]: [string, unknown]) => key.toLowerCase().endsWith('formatted')
  return [...entries.filter((entry) => !isFormatted(entry)), ...entries.filter(isFormatted)]
}

export function applyUserPatch(
  current: ScimUserAttributes,
  operations: readonly ScimPatchOperation[]
): UserPatchOutcome {
  const next = structuredClone(current)
  if (next.extra) {
    for (const attribute of Object.keys(next.extra)) {
      if (isScimPasswordAttribute(attribute)) delete next.extra[attribute]
    }
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
      /**
       * Entra's compliant mode sends one path-less replace whose value object is
       * keyed by dotted attribute paths, so each key is dispatched as if it had
       * arrived as its own operation.
       */
      for (const [attribute, nested] of sortFormattedLast(Object.entries(value))) {
        applyOperation(next, operation.op, attribute, nested, true)
      }
      continue
    }

    applyOperation(next, operation.op, operation.path, operation.value)
  }

  return { next, changed: comparisonKey(current) !== comparisonKey(next) }
}
