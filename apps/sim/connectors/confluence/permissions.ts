import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import type {
  ConfluencePrincipal,
  ConfluenceRestriction,
} from '@/lib/knowledge/access/confluence-permissions'
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

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Confluence request failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

interface SpacePermissionEntry {
  principal?: { type?: string; id?: string }
  operation?: { key?: string; targetType?: string }
}

/**
 * Who may read a space.
 *
 * Only `read` on the space itself counts; the same endpoint reports create,
 * delete and administer permissions, and a person who may delete a page they
 * cannot read is not a thing Confluence models — but reading the operation key
 * is how we avoid granting on one.
 *
 * `anonymous` and access-class principals are not mapped. A space open to
 * anonymous users is the Confluence equivalent of an open Drive share, and it
 * gets the same treatment: not searchable, because a space left open is far
 * more often an oversight than an intention.
 */
export async function listSpaceReadPrincipals(
  cloudId: string,
  accessToken: string,
  spaceId: string
): Promise<ConfluencePrincipal[]> {
  const principals: ConfluencePrincipal[] = []
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (cursor) query.set('cursor', cursor)
    const body = await getJson<{
      results?: SpacePermissionEntry[]
      _links?: { next?: string }
    }>(
      `${apiBase(cloudId)}/api/v2/spaces/${encodeURIComponent(spaceId)}/permissions?${query.toString()}`,
      accessToken
    )

    for (const entry of body.results ?? []) {
      if (entry.operation?.key !== 'read' || entry.operation.targetType !== 'space') continue
      const id = entry.principal?.id
      const type = entry.principal?.type?.toLowerCase()
      if (!id || (type !== 'user' && type !== 'group')) continue
      principals.push({ kind: type, id })
    }

    cursor = nextCursor(body._links?.next)
    if (!cursor) return principals
  }
  throw new Error(`Confluence space permissions exceeded ${MAX_PAGES} pages`)
}

/** Confluence returns the next page as a relative URL carrying an opaque cursor. */
function nextCursor(next: string | undefined): string | undefined {
  if (!next) return undefined
  const cursor = new URLSearchParams(next.split('?')[1] ?? '').get('cursor')
  return cursor ?? undefined
}

interface RestrictionResponse {
  restrictions?: {
    user?: { results?: { accountId?: string; email?: string | null }[] }
    group?: { results?: { id?: string }[] }
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
 */
export async function getReadRestriction(
  cloudId: string,
  accessToken: string,
  contentId: string
): Promise<ConfluenceRestriction> {
  const body = await getJson<RestrictionResponse>(
    `${apiBase(cloudId)}/rest/api/content/${encodeURIComponent(contentId)}/restriction/byOperation/read?expand=restrictions.user,restrictions.group&limit=${PAGE_SIZE}`,
    accessToken
  )

  const users = body.restrictions?.user?.results ?? []
  const groups = body.restrictions?.group?.results ?? []
  if (users.length === 0 && groups.length === 0) return null

  const principals: ConfluencePrincipal[] = []
  for (const user of users) {
    if (user.accountId) principals.push({ kind: 'user', id: user.accountId, email: user.email })
  }
  for (const group of groups) {
    if (group.id) principals.push({ kind: 'group', id: group.id })
  }
  return principals
}

/**
 * A page's ancestors, closest parent first — the order the restriction chain is
 * resolved in.
 *
 * Fetched as one expansion rather than by walking `parentId` upward, which
 * would cost a round trip per level on every page in the space.
 */
export async function listAncestorIds(
  cloudId: string,
  accessToken: string,
  contentId: string
): Promise<string[]> {
  const body = await getJson<{ ancestors?: { id?: string }[] }>(
    `${apiBase(cloudId)}/rest/api/content/${encodeURIComponent(contentId)}?expand=ancestors`,
    accessToken
  )
  const ancestors = (body.ancestors ?? [])
    .map((ancestor) => ancestor.id)
    .filter((id): id is string => Boolean(id))
  /** Confluence returns ancestors root-first; the closest parent decides. */
  return ancestors.reverse()
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
 * people simply cannot be granted access individually — the caller counts them
 * rather than guessing — but they are still reachable through any group they
 * belong to, because group membership resolves addresses the same way and a
 * site that hides one usually hides both.
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

interface RawGroup {
  id?: string
}

/** Every group on the site, by the id its permissions and restrictions name. */
export async function listSiteGroups(
  cloudId: string,
  accessToken: string
): Promise<ConnectorDirectoryGroup[]> {
  const groups: ConnectorDirectoryGroup[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await getJson<{ results?: RawGroup[]; size?: number }>(
      `${apiBase(cloudId)}/rest/api/group?start=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`,
      accessToken
    )
    const results = body.results ?? []
    for (const group of results) {
      if (group.id) groups.push({ id: group.id })
    }
    if (results.length < PAGE_SIZE) return groups
  }
  throw new Error(`Confluence group listing exceeded ${MAX_PAGES} pages`)
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
  const accountIds: string[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await getJson<{ results?: { accountId?: string }[] }>(
      `${apiBase(cloudId)}/rest/api/group/${encodeURIComponent(group.id)}/membersByGroupId?start=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`,
      accessToken
    )
    const results = body.results ?? []
    for (const member of results) {
      if (member.accountId) accountIds.push(member.accountId)
    }
    if (results.length < PAGE_SIZE) break
    if (page === MAX_PAGES - 1) {
      throw new Error(`Confluence group membership exceeded ${MAX_PAGES} pages`)
    }
  }

  const emails = await resolveUserEmails(cloudId, accessToken, accountIds)
  const memberEmails = [...new Set(emails.values())]
  return { group, memberEmails, complete: emails.size === new Set(accountIds).size }
}

/** The Confluence site as a directory, keyed by its cloud id. */
export function openConfluenceDirectory(cloudId: string, accessToken: string): ConnectorDirectory {
  return {
    tenantId: cloudId,
    listGroups: () => listSiteGroups(cloudId, accessToken),
    listGroupMembers: (group) => listGroupMemberEmails(cloudId, accessToken, group),
  }
}
