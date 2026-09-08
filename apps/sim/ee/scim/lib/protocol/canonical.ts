import type { ScimUserAttributes, ScimUserEmail } from '@sim/db/schema'
import { isValidEmailSyntax } from '@sim/utils/string'
import type { ScimGroupWriteParsed, ScimUserWriteParsed } from '@/lib/api/contracts/scim'
import { SCIM_ENTERPRISE_USER_SCHEMA } from '@/ee/scim/lib/protocol/constants'
import { invalidValue } from '@/ee/scim/lib/protocol/errors'
import { isRecord } from '@/ee/scim/lib/protocol/normalize'

/** Attributes Sim models itself; everything else is preserved under `extra`. */
const MODELLED_USER_KEYS = new Set([
  'schemas',
  'id',
  'meta',
  'username',
  'externalid',
  'active',
  'displayname',
  'name',
  'emails',
  'password',
  SCIM_ENTERPRISE_USER_SCHEMA.toLowerCase(),
])

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim()
  return next ? next : undefined
}

/**
 * Chooses the address Sim will use as the account's email.
 *
 * Providers disagree about where it lives: Okta always sends `emails`, Entra
 * often sends only an email-shaped `userName`, and OneLogin sends both with no
 * `primary` flag. Preference order is the flagged primary, then the first
 * address, then an email-shaped `userName`.
 */
function normalizeEmails(
  emails: ScimUserWriteParsed['emails'],
  userName: string
): { emails: ScimUserEmail[]; primary: string } {
  const supplied = (emails ?? [])
    .map((entry) => ({
      value: entry.value.trim().toLowerCase(),
      type: trimmed(entry.type),
      primary: entry.primary === true,
    }))
    .filter((entry) => entry.value.length > 0)

  if (supplied.length === 0) {
    if (!isValidEmailSyntax(userName)) {
      throw invalidValue(
        'A primary email address is required: send emails[], or a userName that is an email address'
      )
    }
    return {
      emails: [{ value: userName, type: 'work', primary: true }],
      primary: userName,
    }
  }

  const primaryIndex = supplied.findIndex((entry) => entry.primary)
  const chosen = primaryIndex >= 0 ? primaryIndex : 0
  const normalized = supplied.map((entry, index) => ({ ...entry, primary: index === chosen }))
  return { emails: normalized, primary: normalized[chosen].value }
}

function formatName(
  name: ScimUserWriteParsed['name'],
  displayName: string | undefined,
  fallback: string
): ScimUserAttributes['name'] {
  const givenName = trimmed(name?.givenName)
  const familyName = trimmed(name?.familyName)
  const joined = [givenName, familyName].filter(Boolean).join(' ')
  const formatted = trimmed(name?.formatted) ?? (joined || trimmed(displayName) || fallback)
  return {
    formatted,
    ...(givenName ? { givenName } : {}),
    ...(familyName ? { familyName } : {}),
  }
}

function collectExtra(body: ScimUserWriteParsed): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (MODELLED_USER_KEYS.has(key.toLowerCase())) continue
    extra[key] = value
  }
  return Object.keys(extra).length > 0 ? extra : undefined
}

/**
 * Turns an inbound User resource into the shape Sim stores.
 *
 * The whole resource is kept, not only the fields Sim reads, so a `GET` returns
 * what the provider wrote and a later `PATCH` applies to the provider's own view
 * rather than to a lossy projection of it.
 */
export function toCanonicalUser(body: ScimUserWriteParsed): ScimUserAttributes {
  const userName = body.userName.toLowerCase()

  const { emails, primary } = normalizeEmails(body.emails, userName)
  const name = formatName(body.name, body.displayName, primary)
  const enterprise = body[SCIM_ENTERPRISE_USER_SCHEMA]
  const extra = collectExtra(body)

  return {
    userName,
    ...(trimmed(body.externalId) ? { externalId: trimmed(body.externalId) } : {}),
    active: body.active ?? true,
    displayName: trimmed(body.displayName) ?? name.formatted,
    name,
    emails,
    ...(isRecord(enterprise) ? { enterprise: normalizeEnterprise(enterprise) } : {}),
    ...(extra ? { extra } : {}),
  }
}

type EnterpriseAttributes = NonNullable<ScimUserAttributes['enterprise']>

const ENTERPRISE_STRING_FIELDS = [
  'department',
  'employeeNumber',
  'costCenter',
  'division',
  'organization',
] as const

/**
 * The enterprise extension as stored. The write contract accepts `manager` as
 * either an identifier string or an object, so the string form is normalized
 * here rather than trusted to match the stored shape.
 */
function normalizeEnterprise(value: Record<string, unknown>): EnterpriseAttributes {
  const text = (candidate: unknown) =>
    typeof candidate === 'string' ? trimmed(candidate) : undefined
  const enterprise: EnterpriseAttributes = {}
  for (const field of ENTERPRISE_STRING_FIELDS) {
    const candidate = text(value[field])
    if (candidate) enterprise[field] = candidate
  }
  const manager = value.manager
  if (typeof manager === 'string' && manager.trim()) {
    enterprise.manager = { value: manager.trim() }
  } else if (isRecord(manager)) {
    const managerValue = text(manager.value)
    const displayName = text(manager.displayName)
    if (managerValue || displayName) {
      enterprise.manager = {
        ...(managerValue ? { value: managerValue } : {}),
        ...(displayName ? { displayName } : {}),
      }
    }
  }
  return enterprise
}

/** The primary address of a canonical resource. */
export function primaryEmail(attributes: ScimUserAttributes): string {
  return (attributes.emails.find((entry) => entry.primary) ?? attributes.emails[0]).value
}

export interface CanonicalScimGroup {
  displayName: string
  externalId?: string
  memberIds: string[]
}

/** Turns an inbound Group resource into a display name and a member id list. */
export function toCanonicalGroup(body: ScimGroupWriteParsed): CanonicalScimGroup {
  const displayName = body.displayName

  const memberIds: string[] = []
  for (const member of body.members ?? []) {
    if (member.type && member.type.toLowerCase() !== 'user') {
      throw invalidValue('Group members must be Users; nested groups are not supported')
    }
    if (!memberIds.includes(member.value)) memberIds.push(member.value)
  }

  return {
    displayName,
    ...(trimmed(body.externalId) ? { externalId: trimmed(body.externalId) } : {}),
    memberIds,
  }
}

/** Reads the member id out of a PATCH value entry, which may be bare or wrapped. */
export function readMemberValue(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim()
  if (isRecord(entry) && typeof entry.value === 'string') return entry.value.trim()
  throw invalidValue('Group member entries require a value')
}
