import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import type {
  ConfluencePrincipal,
  ConfluenceRestriction,
} from '@/lib/knowledge/access/confluence-permissions'
import { fetchWithRetry } from '@/lib/knowledge/documents/utils'
import type {
  ConnectorDirectory,
  ConnectorDirectoryGroup,
  ConnectorDirectoryMembership,
} from '@/connectors/types'

const logger = createLogger('ConfluencePermissions')

const PAGE_SIZE = 250

/** Guards against a site that keeps paginating; far above any real space. */
const MAX_PAGES = 100

function apiBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/confluence/${cloudId}/wiki`
}

/**
 * A GET with the same transient-error retry every other Confluence call gets.
 * With `allowNotFound`, a 404 resolves to null instead of throwing.
 */
async function getJson<T>(url: string, accessToken: string): Promise<T>
async function getJson<T>(
  url: string,
  accessToken: string,
  options: { allowNotFound: true }
): Promise<T | null>
async function getJson<T>(
  url: string,
  accessToken: string,
  options?: { allowNotFound: true }
): Promise<T | null> {
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (response.status === 404 && options?.allowNotFound) return null
  if (!response.ok) {
    throw new Error(`Confluence request failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

/** Confluence returns the next page as a relative URL carrying an opaque cursor. */
function nextCursor(next: string | undefined): string | undefined {
  if (!next) return undefined
  const cursor = new URLSearchParams(next.split('?')[1] ?? '').get('cursor')
  return cursor ?? undefined
}

/**
 * Drains a v2 collection by following `_links.next`, the only termination
 * Confluence documents. The requested page size is a ceiling the server may
 * lower, so a page shorter than it proves nothing.
 */
async function drainV2<T>(url: string, accessToken: string, what: string): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (cursor) query.set('cursor', cursor)
    const body = await getJson<{ results?: T[]; _links?: { next?: string } }>(
      `${url}?${query.toString()}`,
      accessToken
    )
    items.push(...(body.results ?? []))
    cursor = nextCursor(body._links?.next)
    if (!cursor) return items
  }
  throw new Error(`Confluence ${what} exceeded ${MAX_PAGES} pages`)
}

/**
 * Drains a v1 offset collection. The v1 envelope echoes `size` and `limit`
 * and links the next page; a page is the last when no next link follows it.
 */
async function drainV1<T>(url: string, accessToken: string, what: string): Promise<T[]> {
  const items: T[] = []
  let start = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await getJson<{
      results?: T[]
      size?: number
      _links?: { next?: string }
    }>(`${url}?start=${start}&limit=${PAGE_SIZE}`, accessToken)
    const results = body.results ?? []
    items.push(...results)
    if (!body._links?.next || results.length === 0) return items
    start += body.size || results.length
  }
  throw new Error(`Confluence ${what} exceeded ${MAX_PAGES} pages`)
}

interface SpacePermissionEntry {
  principal?: { type?: string; id?: string }
  operation?: { key?: string; targetType?: string }
}

interface SpaceRoleAssignment {
  principal?: { principalType?: string; principalId?: string }
}

/**
 * Who may read a space.
 *
 * Only `read` on the space itself counts; the same endpoint reports create,
 * delete and administer permissions, and a person who may delete a page they
 * cannot read is not a thing Confluence models — but reading the operation key
 * is how we avoid granting on one.
 *
 * A site on space roles reports the grant against a *role* rather than a
 * person or group, and names who holds each role separately. Every space role
 * includes viewing the space — Confluence will not define one without it — so
 * every assignment of a role is a read grant, and the assignments are the
 * principals.
 *
 * `anonymous` and access-class principals ("all licensed users") are not
 * mapped. A space open to everyone on the site is the Confluence equivalent
 * of an open Drive share and gets the same treatment: not searchable, because
 * a space left open is far more often an oversight than an intention. They are
 * counted so a site whose spaces are all open can be recognised from the log.
 */
export async function listSpaceReadPrincipals(
  cloudId: string,
  accessToken: string,
  spaceId: string
): Promise<ConfluencePrincipal[]> {
  const entries = await drainV2<SpacePermissionEntry>(
    `${apiBase(cloudId)}/api/v2/spaces/${encodeURIComponent(spaceId)}/permissions`,
    accessToken,
    'space permissions'
  )

  const principals: ConfluencePrincipal[] = []
  let grantedToRole = false
  let unmapped = 0
  for (const entry of entries) {
    if (entry.operation?.key !== 'read' || entry.operation.targetType !== 'space') continue
    const id = entry.principal?.id
    const type = entry.principal?.type?.toLowerCase()
    if (type === 'role') {
      grantedToRole = true
      continue
    }
    if (!id || (type !== 'user' && type !== 'group')) {
      unmapped += 1
      continue
    }
    principals.push({ kind: type, id })
  }

  if (grantedToRole) {
    const assignments = await drainV2<SpaceRoleAssignment>(
      `${apiBase(cloudId)}/api/v2/spaces/${encodeURIComponent(spaceId)}/role-assignments`,
      accessToken,
      'space role assignments'
    )
    for (const assignment of assignments) {
      const id = assignment.principal?.principalId
      const type = assignment.principal?.principalType?.toLowerCase()
      if (!id) continue
      if (type === 'user' || type === 'group') principals.push({ kind: type, id })
      else unmapped += 1
    }
  }

  if (unmapped > 0) {
    logger.info(
      'Confluence space grants to anonymous or access-class principals were not mirrored',
      {
        cloudId,
        spaceId,
        unmapped,
      }
    )
  }
  return principals
}

interface RestrictionResponse {
  restrictions?: {
    user?: { results?: { accountId?: string; email?: string | null }[]; size?: number }
    group?: { results?: { id?: string }[]; size?: number }
  }
}

/**
 * A page's own read restriction, or `null` when it has none.
 *
 * Confluence reports an unrestricted page as empty user and group lists, and
 * offers no way to restrict a page to nobody — restricting always names at
 * least the person doing it. So empty means inherit, and the distinction the
 * ACL mapper draws between `null` and `[]` is defensive rather than reachable
 * from the product.
 *
 * The user and group lists page independently under one `start`; a
 * restriction naming more people than one page holds is read until both lists
 * come back short.
 */
export async function getReadRestriction(
  cloudId: string,
  accessToken: string,
  contentId: string
): Promise<ConfluenceRestriction> {
  const principals: ConfluencePrincipal[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await getJson<RestrictionResponse>(
      `${apiBase(cloudId)}/rest/api/content/${encodeURIComponent(contentId)}/restriction/byOperation/read?expand=restrictions.user,restrictions.group&start=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`,
      accessToken
    )
    const users = body.restrictions?.user?.results ?? []
    const groups = body.restrictions?.group?.results ?? []
    for (const user of users) {
      if (user.accountId) principals.push({ kind: 'user', id: user.accountId, email: user.email })
    }
    for (const group of groups) {
      if (group.id) principals.push({ kind: 'group', id: group.id })
    }
    if (users.length < PAGE_SIZE && groups.length < PAGE_SIZE) break
    if (page === MAX_PAGES - 1) {
      throw new Error(`Confluence restriction on ${contentId} exceeded ${MAX_PAGES} pages`)
    }
  }
  return principals.length === 0 ? null : principals
}

/**
 * A page's ancestors, closest parent first — the order the restriction chain is
 * resolved in.
 *
 * The v2 ancestors collection is the one Confluence still serves; the v1
 * content expansion this used to read was removed. It returns root first, so
 * the order is reversed here. Blog posts have no ancestors and are never asked.
 */
export async function listAncestorIds(
  cloudId: string,
  accessToken: string,
  pageId: string
): Promise<string[]> {
  const ancestors = await drainV2<{ id?: string }>(
    `${apiBase(cloudId)}/api/v2/pages/${encodeURIComponent(pageId)}/ancestors`,
    accessToken,
    'page ancestors'
  )
  return ancestors
    .map((ancestor) => ancestor.id)
    .filter((id): id is string => Boolean(id))
    .reverse()
}

/** The space a piece of content lives in, for content the listing did not describe. */
export async function describeContent(
  cloudId: string,
  accessToken: string,
  contentId: string
): Promise<{ spaceId: string; contentType: 'page' | 'blogpost' } | null> {
  for (const contentType of ['page', 'blogpost'] as const) {
    const collection = contentType === 'page' ? 'pages' : 'blogposts'
    const body = await getJson<{ spaceId?: string | number }>(
      `${apiBase(cloudId)}/api/v2/${collection}/${encodeURIComponent(contentId)}`,
      accessToken,
      { allowNotFound: true }
    )
    if (body?.spaceId !== undefined) return { spaceId: String(body.spaceId), contentType }
  }
  return null
}

interface BulkUserEntry {
  accountId?: string
  email?: string | null
}

/**
 * Resolves account ids to email addresses, which is the only identifier a Sim
 * reader can be matched by.
 *
 * Confluence Cloud withholds an address whose owner's profile visibility hides
 * it, and returns the account with a null email rather than failing. Those
 * people cannot be granted access individually, and the same withholding
 * applies when they are reached through a group — so the caller counts them,
 * and a group whose membership cannot be named in full is left on its last
 * complete enumeration rather than replaced.
 */
export async function resolveUserEmails(
  cloudId: string,
  accessToken: string,
  accountIds: readonly string[]
): Promise<Map<string, string>> {
  const emails = new Map<string, string>()
  const unique = [...new Set(accountIds)]
  /** `bulk` accepts repeated accountId params; 90 keeps the URL well inside limits. */
  const BULK_SIZE = 90

  for (let offset = 0; offset < unique.length; offset += BULK_SIZE) {
    const batch = unique.slice(offset, offset + BULK_SIZE)
    const query = new URLSearchParams()
    for (const accountId of batch) query.append('accountId', accountId)

    try {
      const body = await getJson<{ results?: BulkUserEntry[] }>(
        `${apiBase(cloudId)}/rest/api/user/bulk?${query.toString()}`,
        accessToken
      )
      for (const entry of body.results ?? []) {
        const email = entry.email ? normalizeEmail(entry.email) : ''
        if (entry.accountId && email) emails.set(entry.accountId, email)
      }
    } catch (error) {
      /**
       * A batch that fails leaves its people unattributed, which hides the
       * pages they were named on. Not fatal: the rest of the corpus still
       * resolves, and the next run retries.
       */
      logger.warn('Could not resolve a batch of Confluence account ids to addresses', {
        cloudId,
        accountIds: batch.length,
      })
    }
  }
  return emails
}

/** Every group on the site, by the id its permissions and restrictions name. */
async function listSiteGroups(
  cloudId: string,
  accessToken: string
): Promise<ConnectorDirectoryGroup[]> {
  const raw = await drainV1<{ id?: string }>(
    `${apiBase(cloudId)}/rest/api/group`,
    accessToken,
    'group listing'
  )
  const groups: ConnectorDirectoryGroup[] = []
  for (const group of raw) {
    if (group.id) groups.push({ id: group.id })
  }
  return groups
}

/**
 * The people in one group, as addresses.
 *
 * Confluence groups do not nest, so there is no walk to do — the whole
 * membership is one paginated listing. What it returns is account ids, so the
 * addresses come from the same bulk resolution the ACL path uses.
 *
 * A member whose address the site withholds is reported by leaving the
 * membership incomplete rather than by dropping them quietly: a group is only
 * usable as a grant if we can name everyone in it, and a partial membership
 * that replaced a stored one would revoke whoever was withheld.
 */
export async function listGroupMemberEmails(
  cloudId: string,
  accessToken: string,
  group: ConnectorDirectoryGroup
): Promise<ConnectorDirectoryMembership> {
  const members = await drainV1<{ accountId?: string }>(
    `${apiBase(cloudId)}/rest/api/group/${encodeURIComponent(group.id)}/membersByGroupId`,
    accessToken,
    'group membership'
  )
  const accountIds = [...new Set(members.flatMap((m) => (m.accountId ? [m.accountId] : [])))]
  const emails = await resolveUserEmails(cloudId, accessToken, accountIds)
  return {
    group,
    memberEmails: [...new Set(emails.values())],
    complete: emails.size === accountIds.length,
  }
}

/** The Confluence site as a directory, keyed by its cloud id. */
export function openConfluenceDirectory(
  providerId: string,
  cloudId: string,
  accessToken: string
): ConnectorDirectory {
  return {
    providerId,
    tenantId: cloudId,
    listGroups: () => listSiteGroups(cloudId, accessToken),
    listGroupMembers: (group) => listGroupMemberEmails(cloudId, accessToken, group),
  }
}
