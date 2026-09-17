import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { sortObjectKeysDeep } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  type ConfluencePrincipal,
  type ConfluenceRestriction,
  confluenceSubjectToken,
} from '@/lib/knowledge/access/confluence-permissions'
import { MAX_ACL_TOKENS } from '@/lib/knowledge/access/tokens'
import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import type { RetryOptions } from '@/lib/knowledge/documents/utils'
import { extractCursor } from '@/connectors/confluence/cursor'
import type {
  ConnectorDirectory,
  ConnectorDirectoryGroup,
  ConnectorDirectoryMembership,
} from '@/connectors/types'

const logger = createLogger('ConfluencePermissions')

const PAGE_SIZE = 250
const GROUP_PAGE_SIZE = 200

/** Bounds provider pagination, including malformed continuation responses. */
const MAX_PAGES = 100
const MAX_PERMISSION_PAGES = 1000
const PERMISSION_RESPONSE_MAX_BYTES = 1024 * 1024
const MAX_PERMISSION_CURSOR_LENGTH = 8192
const PERMISSION_COLLECTION_TIMEOUT_MS = 5 * 60 * 1000
const PREFLIGHT_RESPONSE_MAX_BYTES = 256 * 1024

function apiBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/confluence/${cloudId}/wiki`
}

interface ConfluenceGetOptions {
  retryOptions?: RetryOptions
  maxResponseBytes?: number
}

/**
 * A GET with the same transient-error retry every other Confluence call gets.
 * With `allowNotFound`, a 404 resolves to null instead of throwing.
 */
async function getJson<T>(
  url: string,
  accessToken: string,
  options?: ConfluenceGetOptions & { allowNotFound?: false }
): Promise<T>
async function getJson<T>(
  url: string,
  accessToken: string,
  options: ConfluenceGetOptions & { allowNotFound: true }
): Promise<T | null>
async function getJson<T>(
  url: string,
  accessToken: string,
  options?: ConfluenceGetOptions & { allowNotFound?: boolean }
): Promise<T | null> {
  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    },
    options?.retryOptions
  )
  if (response.status === 404 && options?.allowNotFound) return null
  if (!response.ok) {
    throw new Error(`Confluence request failed: ${response.status} ${response.statusText}`)
  }
  return options?.maxResponseBytes
    ? readResponseJsonWithLimit<T>(response, {
        maxBytes: options.maxResponseBytes,
        label: 'Confluence permission check',
      })
    : ((await response.json()) as T)
}

/**
 * Reduces permission pages without retaining unrelated assignments. Completion
 * requires EOF; distinct cursors cannot conceal a repeated page of assignments.
 */
async function visitPermissionPages<T>(
  url: string,
  accessToken: string,
  context: { cloudId: string; spaceId: string; collection: string },
  visit: (entries: T[]) => void
): Promise<void> {
  const cursors = new Set<string>()
  const pages = new Set<string>()
  const signal = AbortSignal.timeout(PERMISSION_COLLECTION_TIMEOUT_MS)
  let cursor: string | undefined
  let entries = 0
  let fetchedPages = 0
  const fail = (reason: string): never => {
    logger.warn('Confluence permission pagination did not complete', {
      ...context,
      pages: fetchedPages,
      entries,
      reason,
    })
    throw new Error(`Confluence ${context.collection} ${reason}`)
  }
  for (let page = 0; page < MAX_PERMISSION_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (cursor) query.set('cursor', cursor)
    const body = await getJson<{ results?: T[]; _links?: { next?: string } }>(
      `${url}?${query.toString()}`,
      accessToken,
      { maxResponseBytes: PERMISSION_RESPONSE_MAX_BYTES, retryOptions: { signal } }
    )
    fetchedPages += 1
    if (!Array.isArray(body.results) || body.results.length > PAGE_SIZE) {
      return fail('returned an invalid permission page')
    }
    const results = body.results
    const next = body._links?.next
    if (results.length > 0) {
      const fingerprint = createHash('sha256')
        .update(
          results
            .map((entry) => JSON.stringify(sortObjectKeysDeep(entry)))
            .sort()
            .join('\n')
        )
        .digest('hex')
      if (pages.has(fingerprint)) fail('repeated a permission page')
      pages.add(fingerprint)
    }
    entries += results.length
    visit(results)
    if (!next) {
      if (page >= MAX_PAGES) {
        logger.info('Completed a large Confluence permission collection', {
          ...context,
          pages: page + 1,
          entries,
        })
      }
      return
    }
    cursor = extractCursor(next)
    if (!cursor || cursor.length > MAX_PERMISSION_CURSOR_LENGTH) {
      return fail('returned an invalid or repeated permission continuation')
    }
    const cursorHash = createHash('sha256').update(cursor).digest('hex')
    if (cursors.has(cursorHash)) fail('returned an invalid or repeated permission continuation')
    cursors.add(cursorHash)
  }
  fail(`exceeded ${MAX_PERMISSION_PAGES} pages (${entries} entries)`)
}

/**
 * Drains a v1 offset collection. The v1 envelope echoes `size` and `limit`
 * and links the next page; a page is the last when no next link follows it.
 */
async function drainV1<T>(url: string, accessToken: string, what: string): Promise<T[]> {
  const items: T[] = []
  const requestUrl = new URL(url)
  requestUrl.searchParams.set('limit', String(GROUP_PAGE_SIZE))
  let start = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    requestUrl.searchParams.set('start', String(start))
    const body = await getJson<{
      results?: T[]
      size?: number
      _links?: { next?: string }
    }>(requestUrl.toString(), accessToken)
    const results = body.results ?? []
    items.push(...results)
    if (!body._links?.next) return items
    if (results.length === 0) throw new Error(`Confluence ${what} returned an empty continuation`)
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
 * Checks mirrored-permission capabilities on one selected space, one site group,
 * and one item of each requested content type. Every collection is a single
 * bounded request; continuations are deliberately ignored. Empty collections
 * remain valid, but cannot prove access to an endpoint requiring an item ID.
 * This does not certify every document's ACL: the crawl verifies each separately.
 */
export async function validateConfluencePermissionAccess(input: {
  cloudId: string
  accessToken: string
  spaceId: string
  contentType: string
  retryOptions: RetryOptions
}): Promise<void> {
  const { cloudId, accessToken, spaceId, contentType, retryOptions } = input
  const base = apiBase(cloudId)
  const read = async <T>(path: string, capability: string, scopes: string): Promise<T> => {
    try {
      return await getJson<T>(`${base}${path}`, accessToken, {
        retryOptions,
        maxResponseBytes: PREFLIGHT_RESPONSE_MAX_BYTES,
      })
    } catch {
      if (retryOptions.signal?.aborted) {
        throw new Error('Confluence permission checks timed out. Try again.')
      }
      throw new Error(
        `Could not verify Confluence ${capability}. Check the service account's access and API token scopes (${scopes}), then try again.`
      )
    }
  }
  const collection = async <T>(path: string, capability: string, scopes: string): Promise<T[]> => {
    const body = await read<{ results?: T[] }>(path, capability, scopes)
    if (!Array.isArray(body?.results)) {
      throw new Error(`Confluence returned an invalid ${capability} response. Try again.`)
    }
    return body.results
  }

  const groups = await collection<{ id?: string }>(
    '/rest/api/group?limit=1',
    'group directory',
    'read:group:confluence'
  )
  if (groups.length > 0) {
    const groupId = groups[0]?.id
    if (!groupId) throw new Error('Confluence returned a group without an ID. Try again.')
    await collection(
      `/rest/api/group/${encodeURIComponent(groupId)}/membersByGroupId?limit=1`,
      'group membership',
      'read:group:confluence and read:user:confluence'
    )
  }

  const encodedSpaceId = encodeURIComponent(spaceId)
  const permissions = await collection<SpacePermissionEntry>(
    `/api/v2/spaces/${encodedSpaceId}/permissions?limit=${PAGE_SIZE}`,
    'space permissions',
    'read:space:confluence'
  )
  if (
    permissions.some(
      (entry) =>
        entry?.operation?.key === 'read' &&
        entry.operation.targetType === 'space' &&
        entry.principal?.type?.toLowerCase() === 'role'
    )
  ) {
    await collection(
      `/api/v2/spaces/${encodedSpaceId}/role-assignments?limit=1`,
      'space role assignments',
      'read:space.permission:confluence'
    )
  }

  const contentTypes = contentType === 'all' ? ['page', 'blogpost'] : [contentType]
  for (const type of contentTypes) {
    const collectionName = type === 'blogpost' ? 'blogposts' : 'pages'
    const content = await collection<{ id?: string }>(
      `/api/v2/spaces/${encodedSpaceId}/${collectionName}?limit=1&status=current`,
      `${collectionName} for the permission check`,
      type === 'blogpost' ? 'read:blogpost:confluence' : 'read:page:confluence'
    )
    if (content.length === 0) continue
    const contentId = content[0]?.id
    if (!contentId) throw new Error('Confluence returned content without an ID. Try again.')
    const encodedContentId = encodeURIComponent(contentId)
    const restriction = await read<RestrictionResponse>(
      `/rest/api/content/${encodedContentId}/restriction/byOperation/read?expand=restrictions.user,restrictions.group&limit=1`,
      'content restrictions',
      'read:confluence-content.all'
    )
    if (
      !Array.isArray(restriction?.restrictions?.user?.results) ||
      !Array.isArray(restriction.restrictions.group?.results)
    ) {
      throw new Error('Confluence returned invalid content restrictions. Try again.')
    }
    if (type !== 'blogpost') {
      await collection(
        `/api/v2/pages/${encodedContentId}/ancestors?limit=1`,
        'ancestor metadata',
        'read:content.metadata:confluence'
      )
    }
  }
}

/**
 * Space roles include read access. Their assignments may be flattened into
 * permission entries or returned separately. Licensed-user and product-admin
 * classes resolve through Confluence's accessType group filter, never names.
 */
export async function listSpaceReadPrincipals(
  cloudId: string,
  accessToken: string,
  spaceId: string
): Promise<ConfluencePrincipal[]> {
  const principals = new Map<string, ConfluencePrincipal>()
  let principalBytes = 0
  const accessTypes = new Set<'user' | 'admin'>()
  let grantedToRole = false
  let unmapped = 0
  const addPrincipal = (type: string | undefined, id: string | undefined) => {
    if (!id) {
      unmapped += 1
    } else if (type === 'user' || type === 'group') {
      const key = `${type}:${id}`
      if (!principals.has(key)) {
        principalBytes += Buffer.byteLength(key, 'utf8')
        if (principals.size >= MAX_ACL_TOKENS || principalBytes > PERMISSION_RESPONSE_MAX_BYTES) {
          throw new Error('Confluence space readers exceeded the document permission limit')
        }
        principals.set(key, { kind: type, id })
      }
    } else if (type === 'access-class') {
      const accessClass = id.toLowerCase().replaceAll('_', '-')
      if (accessClass === 'all-licensed-users') {
        accessTypes.add('user')
        /** Confluence app admins also have licensed app access. */
        accessTypes.add('admin')
      } else if (accessClass === 'all-product-admins') accessTypes.add('admin')
      else unmapped += 1
    } else {
      unmapped += 1
    }
  }
  await visitPermissionPages<SpacePermissionEntry>(
    `${apiBase(cloudId)}/api/v2/spaces/${encodeURIComponent(spaceId)}/permissions`,
    accessToken,
    { cloudId, spaceId, collection: 'space permissions' },
    (entries) => {
      for (const entry of entries) {
        if (entry.operation?.key !== 'read' || entry.operation.targetType !== 'space') continue
        const id = entry.principal?.id
        const type = entry.principal?.type?.toLowerCase().replaceAll('_', '-')
        if (type === 'role') {
          grantedToRole = true
          continue
        }
        addPrincipal(type, id)
      }
    }
  )

  if (grantedToRole) {
    await visitPermissionPages<SpaceRoleAssignment>(
      `${apiBase(cloudId)}/api/v2/spaces/${encodeURIComponent(spaceId)}/role-assignments`,
      accessToken,
      { cloudId, spaceId, collection: 'space role assignments' },
      (assignments) => {
        for (const assignment of assignments) {
          const id = assignment.principal?.principalId
          const type = assignment.principal?.principalType?.toLowerCase().replaceAll('_', '-')
          addPrincipal(type, id)
        }
      }
    )
  }

  for (const accessType of accessTypes) {
    const groups = await drainV1<{ id?: string }>(
      `${apiBase(cloudId)}/rest/api/group?accessType=${accessType}`,
      accessToken,
      `${accessType} access groups`
    )
    for (const group of groups) {
      if (!group.id) throw new Error('Confluence access group is missing its id')
      addPrincipal('group', group.id)
    }
  }

  if (unmapped > 0) {
    logger.info(
      'Confluence space grants to anonymous or unsupported principals were not mirrored',
      {
        cloudId,
        spaceId,
        unmapped,
      }
    )
  }
  return [...principals.values()]
}

interface RestrictionPage<T> {
  results?: T[]
  start?: number
  limit?: number
  size?: number
  totalSize?: number
  _links?: { next?: string }
}

interface RestrictionResponse {
  restrictions?: {
    user?: RestrictionPage<{ accountId?: string }>
    group?: RestrictionPage<{ id?: string }>
  }
}

/** Uses the provider's effective page size; requested limits may be capped. */
function restrictionNextStart(page: RestrictionPage<unknown>, start: number): number | null {
  const count = page.results!.length
  for (const value of [page.start, page.size, page.limit, page.totalSize]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error('Confluence returned invalid read-restriction pagination')
    }
  }
  /** UserArray defaults totalSize to zero when a total count was not requested. */
  const totalSize = page.totalSize === 0 ? undefined : page.totalSize
  if (
    (page.start !== undefined && page.start !== start) ||
    (page.size !== undefined && page.size !== count) ||
    (page.limit !== undefined && (page.limit === 0 || count > page.limit)) ||
    (totalSize !== undefined && count > 0 && start + count > totalSize)
  ) {
    throw new Error('Confluence returned inconsistent read-restriction pagination')
  }

  const next = page._links?.next
  if (next) {
    const nextStart = new URL(next, 'https://api.atlassian.com').searchParams.get('start')
    if (!nextStart || !/^\d+$/.test(nextStart) || Number(nextStart) <= start) {
      throw new Error('Confluence read-restriction pagination did not advance')
    }
  }
  const hasMore =
    Boolean(next) ||
    (totalSize !== undefined ? start + count < totalSize : count >= (page.limit ?? PAGE_SIZE))
  if (!hasMore) return null
  if (count === 0) throw new Error('Confluence returned an empty read-restriction continuation')
  return start + count
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
 * The user and group lists may have different effective limits under one
 * `start`. Advance by the shorter unfinished collection and deduplicate the
 * overlap in the other collection so neither list skips principals.
 */
export async function getReadRestriction(
  cloudId: string,
  accessToken: string,
  contentId: string
): Promise<ConfluenceRestriction> {
  const principals = new Map<string, ConfluencePrincipal>()
  let start = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await getJson<RestrictionResponse>(
      `${apiBase(cloudId)}/rest/api/content/${encodeURIComponent(contentId)}/restriction/byOperation/read?expand=restrictions.user,restrictions.group&start=${start}&limit=${PAGE_SIZE}`,
      accessToken
    )
    const users = body?.restrictions?.user?.results
    const groups = body?.restrictions?.group?.results
    if (!Array.isArray(users) || !Array.isArray(groups)) {
      throw new Error('Confluence omitted an expanded read-restriction collection')
    }
    for (const user of users) {
      if (!user.accountId) throw new Error('Confluence read restriction is missing an account id')
      principals.set(`user:${user.accountId}`, { kind: 'user', id: user.accountId })
    }
    for (const group of groups) {
      if (!group.id) throw new Error('Confluence read restriction is missing a group id')
      principals.set(`group:${group.id}`, { kind: 'group', id: group.id })
    }
    const nextStarts = [
      restrictionNextStart(body.restrictions!.user!, start),
      restrictionNextStart(body.restrictions!.group!, start),
    ].filter((next): next is number => next !== null)
    if (nextStarts.length === 0) {
      return principals.size === 0 ? null : [...principals.values()]
    }
    start = Math.min(...nextStarts)
  }
  throw new Error(`Confluence restriction on ${contentId} exceeded ${MAX_PAGES} pages`)
}

/**
 * Ancestor responses have no cursor: continue from the first returned ancestor
 * until its own ancestor list is empty. A short response can still be truncated.
 * Return closest parent first for the restriction chain.
 */
export async function listAncestorIds(
  cloudId: string,
  accessToken: string,
  pageId: string
): Promise<string[]> {
  const collections: Record<string, string> = {
    page: 'pages',
    folder: 'folders',
    database: 'databases',
    embed: 'embeds',
    whiteboard: 'whiteboards',
  }
  const ids: string[] = []
  const seen = new Set([pageId])
  let currentId = pageId
  let collection = 'pages'
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await getJson<{ results?: { id?: string; type?: string }[] }>(
      `${apiBase(cloudId)}/api/v2/${collection}/${encodeURIComponent(currentId)}/ancestors?limit=${PAGE_SIZE}`,
      accessToken
    )
    if (!Array.isArray(body.results)) throw new Error('Confluence omitted the ancestor list')
    if (body.results.length === 0) return ids
    for (const ancestor of [...body.results].reverse()) {
      if (!ancestor.id || seen.has(ancestor.id)) {
        throw new Error('Confluence returned an invalid or cyclic ancestor chain')
      }
      seen.add(ancestor.id)
      ids.push(ancestor.id)
    }
    const first = body.results[0]
    currentId = first.id!
    const nextCollection = collections[first.type ?? 'page']
    if (!nextCollection) throw new Error('Confluence returned an unsupported ancestor type')
    collection = nextCollection
  }
  throw new Error(`Confluence ancestors exceeded ${MAX_PAGES} pages`)
}

/** The space a piece of content lives in, for content the listing did not describe. */
export async function describeContent(
  cloudId: string,
  accessToken: string,
  contentId: string
): Promise<{ spaceId: string; contentType: 'page' | 'blogpost' } | null> {
  for (const contentType of ['page', 'blogpost'] as const) {
    const collection = `${contentType}s`
    const body = await getJson<{ spaceId?: string | number }>(
      `${apiBase(cloudId)}/api/v2/${collection}/${encodeURIComponent(contentId)}`,
      accessToken,
      { allowNotFound: true }
    )
    if (body?.spaceId !== undefined) return { spaceId: String(body.spaceId), contentType }
  }
  return null
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

/** Account IDs remain usable when Confluence profile privacy hides emails. */
export async function listGroupMemberTokens(
  cloudId: string,
  accessToken: string,
  group: ConnectorDirectoryGroup
): Promise<ConnectorDirectoryMembership> {
  const members = await drainV1<{ accountId?: string }>(
    `${apiBase(cloudId)}/rest/api/group/${encodeURIComponent(group.id)}/membersByGroupId`,
    accessToken,
    'group membership'
  )
  const tokens = new Set<string>()
  for (const member of members) {
    if (!member.accountId) throw new Error('Confluence group member is missing an account id')
    tokens.add(confluenceSubjectToken(member.accountId))
  }
  return { group, memberTokens: [...tokens], complete: true }
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
    listGroupMembers: (group) => listGroupMemberTokens(cloudId, accessToken, group),
  }
}
