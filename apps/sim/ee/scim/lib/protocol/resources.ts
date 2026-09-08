import type { ScimUserAttributes } from '@sim/db/schema'
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_MAX_PAGE_SIZE,
  SCIM_USER_SCHEMA,
} from '@/ee/scim/lib/protocol/constants'
import { invalidValue } from '@/ee/scim/lib/protocol/errors'

export interface ScimResourceMeta {
  resourceType: 'User' | 'Group'
  created: string
  lastModified: string
  location: string
  version: string
}

export interface ScimUserResource {
  schemas: string[]
  id: string
  externalId?: string
  userName: string
  active: boolean
  displayName: string
  name: { formatted: string; givenName?: string; familyName?: string }
  emails: Array<{ value: string; type?: string; primary: boolean }>
  groups: Array<{ value: string; display: string; $ref: string }>
  meta: ScimResourceMeta
  [attribute: string]: unknown
}

export interface ScimGroupResource {
  schemas: string[]
  id: string
  externalId?: string
  displayName: string
  members?: Array<{ value: string; display?: string; $ref: string; type: 'User' }>
  meta: ScimResourceMeta
  [attribute: string]: unknown
}

export interface ScimListResponse<Resource> {
  schemas: [typeof SCIM_LIST_RESPONSE_SCHEMA]
  totalResults: number
  startIndex: number
  itemsPerPage: number
  Resources: Resource[]
}

/**
 * An entity tag derived from the row's last write.
 *
 * Advertised as unsupported in `ServiceProviderConfig`, so no provider will send
 * `If-Match`. It is still returned because Okta's import surfaces `meta.version`
 * in its admin UI, where an empty value reads as a broken integration.
 */
function versionOf(updatedAt: Date): string {
  return `W/"${updatedAt.getTime()}"`
}

export interface UserResourceRow {
  id: string
  externalId: string | null
  userName: string
  active: boolean
  attributes: ScimUserAttributes
  createdAt: Date
  updatedAt: Date
  /** The Sim account's address, which is authoritative over the stored copy. */
  email: string
  groups: Array<{ id: string; displayName: string }>
}

export function toUserResource(row: UserResourceRow, baseUrl: string): ScimUserResource {
  const stored = row.attributes
  const primaryType = stored.emails.find((entry) => entry.primary)?.type

  /**
   * The address comes from the Sim account rather than the stored resource. The
   * two only diverge when something outside SCIM changed it, and reporting the
   * stale copy would tell the directory its write is still in place while sign-in
   * uses a different address.
   */
  const emails: ScimUserResource['emails'] = [
    { value: row.email, primary: true, ...(primaryType ? { type: primaryType } : {}) },
    ...stored.emails
      .filter((entry) => !entry.primary && entry.value !== row.email)
      .map((entry) => ({
        value: entry.value,
        primary: false,
        ...(entry.type ? { type: entry.type } : {}),
      })),
  ]

  return {
    schemas: [
      SCIM_USER_SCHEMA,
      ...(stored.enterprise ? [SCIM_ENTERPRISE_USER_SCHEMA] : []),
      ...Object.keys(stored.extra ?? {}).filter(isSchemaUrn),
    ],
    ...(stored.extra ?? {}),
    id: row.id,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    userName: row.userName,
    active: row.active,
    displayName: stored.displayName,
    name: stored.name,
    emails,
    groups: row.groups.map((group) => ({
      value: group.id,
      display: group.displayName,
      $ref: `${baseUrl}/Groups/${group.id}`,
    })),
    ...(stored.enterprise ? { [SCIM_ENTERPRISE_USER_SCHEMA]: stored.enterprise } : {}),
    meta: {
      resourceType: 'User',
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `${baseUrl}/Users/${row.id}`,
      version: versionOf(row.updatedAt),
    },
  }
}

export interface GroupResourceRow {
  id: string
  externalId: string | null
  displayName: string
  createdAt: Date
  updatedAt: Date
  members?: Array<{ scimUserId: string; displayName: string }>
}

export function toGroupResource(row: GroupResourceRow, baseUrl: string): ScimGroupResource {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: row.id,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    displayName: row.displayName,
    ...(row.members
      ? {
          members: row.members.map((member) => ({
            value: member.scimUserId,
            display: member.displayName,
            $ref: `${baseUrl}/Users/${member.scimUserId}`,
            type: 'User' as const,
          })),
        }
      : {}),
    meta: {
      resourceType: 'Group',
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `${baseUrl}/Groups/${row.id}`,
      version: versionOf(row.updatedAt),
    },
  }
}

export function toListResponse<Resource>(
  resources: Resource[],
  totalResults: number,
  startIndex: number
): ScimListResponse<Resource> {
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  }
}

export interface ScimPage {
  startIndex: number
  offset: number
  count: number
}

/**
 * Resolves the page a list request asked for.
 *
 * `startIndex` is 1-based per RFC 7644 and clamped up rather than rejected,
 * because Okta's import sends `startIndex=0` on its first page. `count` is
 * capped so one request cannot ask the database for an unbounded page.
 */
export function resolvePage(input: {
  startIndex?: number | undefined
  count?: number | undefined
}): ScimPage {
  const rawStart = input.startIndex
  const rawCount = input.count

  const startIndex = Math.max(rawStart ?? 1, 1)
  const count = Math.min(Math.max(rawCount ?? SCIM_MAX_PAGE_SIZE, 0), SCIM_MAX_PAGE_SIZE)
  return { startIndex, offset: startIndex - 1, count }
}

/**
 * The attribute projection a request asked for.
 *
 * Only `members` on Groups and `groups` on Users are honored as real query
 * shortcuts, because those are the two that cost a join. Entra sends
 * `excludedAttributes=members` on every group list, and answering it by loading
 * the membership and then discarding it would defeat the point of the request.
 */
export interface ScimAttributeProjection {
  include?: Set<string>
  exclude?: Set<string>
}

function parseAttributeList(value: string | undefined): Set<string> | undefined {
  if (!value) return undefined
  const names = value
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  return names.length > 0 ? new Set(names) : undefined
}

export function parseAttributeProjection(query: {
  attributes?: string | undefined
  excludedAttributes?: string | undefined
}): ScimAttributeProjection {
  const include = parseAttributeList(query.attributes)
  const exclude = parseAttributeList(query.excludedAttributes)
  if (include && exclude) {
    throw invalidValue('attributes and excludedAttributes cannot be combined')
  }
  return { ...(include ? { include } : {}), ...(exclude ? { exclude } : {}) }
}

/** Whether a projection asks for an attribute that costs a separate query. */
export function projectionWants(projection: ScimAttributeProjection, attribute: string): boolean {
  const name = attribute.toLowerCase()
  if (projection.exclude?.has(name)) return false
  if (projection.include) return projection.include.has(name)
  return true
}

/** Attributes every resource keeps regardless of the projection requested. */
/** An `extra` key that is itself a schema URN carries a provider extension the resource must declare. */
function isSchemaUrn(key: string): boolean {
  return key.startsWith('urn:')
}

const ALWAYS_RETURNED = new Set(['schemas', 'id', 'meta'])

/** Drops attributes the request did not ask for. */
export function projectResource<Resource extends object>(
  resource: Resource,
  projection: ScimAttributeProjection
): Resource {
  if (!projection.include && !projection.exclude) return resource
  const projected: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(resource)) {
    const name = key.toLowerCase()
    if (ALWAYS_RETURNED.has(name)) {
      projected[key] = value
      continue
    }
    if (projectionWants(projection, name)) projected[key] = value
  }
  return projected as Resource
}
