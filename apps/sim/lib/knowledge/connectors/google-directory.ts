import { createLogger } from '@sim/logger'
import { MAX_GROUP_NESTING_DEPTH } from '@/lib/knowledge/access/external-groups'

const logger = createLogger('GoogleDirectory')

const DIRECTORY_BASE = 'https://admin.googleapis.com/admin/directory/v1'
const PAGE_SIZE = 200

/** Guards against a directory that keeps paginating; far above any real domain. */
const MAX_PAGES = 200

export interface DirectoryGroup {
  /** The group's email, case-folded — the identifier a `g:` token carries. */
  id: string
}

export interface DirectoryGroupMembership {
  group: DirectoryGroup
  /** Case-folded addresses of every person in the group, nesting flattened. */
  memberEmails: string[]
  /**
   * False when the walk could not be completed — a nesting depth cap hit, or a
   * subgroup that failed to enumerate. The caller must not treat a partial
   * membership as authoritative: replacing a group's members with a subset
   * silently revokes whoever was in the part that failed.
   */
  complete: boolean
}

interface DirectoryListResponse<T> {
  nextPageToken?: string
  items?: T[]
}

/**
 * Reads a paginated Admin SDK collection, following `nextPageToken`.
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

    const response = await fetch(`${url}?${query.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(
        `Google Directory request failed: ${response.status} ${response.statusText} (${itemsKey})`
      )
    }

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

/** Every group in the Workspace domain the crawl is scoped to. */
export async function listDomainGroups(
  accessToken: string,
  domain: string
): Promise<DirectoryGroup[]> {
  const raw = await listAll<RawGroup>(`${DIRECTORY_BASE}/groups`, accessToken, 'groups', { domain })
  const groups: DirectoryGroup[] = []
  for (const group of raw) {
    const id = group.email?.trim().toLowerCase()
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
  group: DirectoryGroup
): Promise<DirectoryGroupMembership> {
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
      const email = member.email?.trim().toLowerCase()
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
