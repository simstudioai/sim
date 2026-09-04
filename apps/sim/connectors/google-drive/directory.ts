import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import { canonicalGroupId } from '@/lib/knowledge/access/tokens'
import { fetchGoogleDriveWithRetry } from '@/connectors/google-drive/google-drive-errors'
import type {
  ConnectorDirectory,
  ConnectorDirectoryGroup,
  ConnectorDirectoryMembership,
} from '@/connectors/types'

const logger = createLogger('GoogleDirectory')

const DIRECTORY_BASE = 'https://admin.googleapis.com/admin/directory/v1'
const PAGE_SIZE = 200

/** Guards against a directory that keeps paginating; far above any real domain. */
const MAX_PAGES = 200

/**
 * How deep nested groups are followed when flattening membership.
 *
 * A directory can nest groups arbitrarily and can contain cycles, so the walk
 * needs both a visited set and a depth bound. Onyx does not recurse at all,
 * which silently drops everyone who is a member only through a subgroup; a
 * bounded walk covers every real directory while still terminating.
 */
const MAX_GROUP_NESTING_DEPTH = 10

/**
 * The Workspace domain an administrator's address belongs to, or undefined
 * when the address is blank.
 *
 * This is the tenant of every group token a Drive crawl writes and of every
 * group the directory sync stores, so it is derived in exactly one place: a
 * crawl and a directory that spelled it differently would produce grants
 * nothing ever resolves.
 */
export function googleWorkspaceDomain(adminEmail: unknown): string | undefined {
  if (typeof adminEmail !== 'string') return undefined
  const domain = normalizeEmail(adminEmail).split('@')[1]
  return domain || undefined
}

interface DirectoryListResponse<T> {
  nextPageToken?: string
  items?: T[]
}

/**
 * Reads a paginated Admin SDK collection, following `nextPageToken`, with the
 * same transient-error retry every Drive call gets.
 *
 * Throws rather than returning what it managed to read: every caller here is
 * building a membership set that is only meaningful in full, and a truncated
 * one would look like a group that lost members.
 */
async function listAll<T>(
  url: string,
  accessToken: string,
  itemsKey: 'groups' | 'members',
  params: Record<string, string>
): Promise<T[]> {
  const items: T[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ ...params, maxResults: String(PAGE_SIZE) })
    if (pageToken) query.set('pageToken', pageToken)

    const response = await fetchGoogleDriveWithRetry(`${url}?${query.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })

    const body = (await response.json()) as DirectoryListResponse<T> & Record<string, unknown>
    const pageItems = (body[itemsKey] as T[] | undefined) ?? []
    items.push(...pageItems)

    pageToken = body.nextPageToken
    if (!pageToken) return items
  }
  throw new Error(`Google Directory listing exceeded ${MAX_PAGES} pages (${itemsKey})`)
}

interface RawGroup {
  email?: string
}

interface RawMember {
  email?: string
  type?: string
  status?: string
}

/**
 * Every group in the Workspace customer the administrator belongs to.
 *
 * `customer=my_customer` rather than `domain=`: a Workspace customer routinely
 * owns several domains, and a grant to a group on a secondary domain would
 * otherwise name a group the directory never enumerated — readable by nobody.
 */
export async function listDomainGroups(accessToken: string): Promise<ConnectorDirectoryGroup[]> {
  const raw = await listAll<RawGroup>(`${DIRECTORY_BASE}/groups`, accessToken, 'groups', {
    customer: 'my_customer',
  })
  const groups: ConnectorDirectoryGroup[] = []
  for (const group of raw) {
    const id = group.email ? canonicalGroupId(group.email) : ''
    if (!id) continue
    groups.push({ id })
  }
  return groups
}

/**
 * Every person in a group, following nested groups to their members.
 *
 * Onyx reads one level and stops, so a person who belongs only through a
 * subgroup silently gets nothing even though the source grants them access.
 * Nesting is real in large directories, so the walk follows it — bounded by
 * {@link MAX_GROUP_NESTING_DEPTH} and a visited set, because a directory may
 * contain cycles and will happily report one.
 *
 * A member whose status is not `ACTIVE` is skipped: a suspended or pending
 * member is one the source is not currently granting access to.
 */
export async function listGroupMembers(
  accessToken: string,
  group: ConnectorDirectoryGroup
): Promise<ConnectorDirectoryMembership> {
  const memberEmails = new Set<string>()
  const visited = new Set<string>([group.id])
  let complete = true

  async function walk(groupId: string, depth: number): Promise<void> {
    if (depth > MAX_GROUP_NESTING_DEPTH) {
      complete = false
      logger.warn('Stopped flattening a group at the nesting cap', { groupId, root: group.id })
      return
    }

    const members = await listAll<RawMember>(
      `${DIRECTORY_BASE}/groups/${encodeURIComponent(groupId)}/members`,
      accessToken,
      'members',
      {}
    )

    for (const member of members) {
      const email = member.email ? normalizeEmail(member.email) : ''
      if (!email) continue
      if (member.status && member.status.toUpperCase() !== 'ACTIVE') continue

      if (member.type?.toUpperCase() === 'GROUP') {
        if (visited.has(email)) continue
        visited.add(email)
        await walk(email, depth + 1)
        continue
      }
      memberEmails.add(email)
    }
  }

  await walk(group.id, 0)
  return { group, memberEmails: [...memberEmails], complete }
}

/** The Workspace domain the crawl is looking at, as a directory. */
export function openGoogleDirectory(
  accessToken: string,
  adminEmail: unknown
): ConnectorDirectory | null {
  const tenantId = googleWorkspaceDomain(adminEmail)
  if (!tenantId) return null
  return {
    tenantId,
    listGroups: () => listDomainGroups(accessToken),
    listGroupMembers: (group) => listGroupMembers(accessToken, group),
  }
}
