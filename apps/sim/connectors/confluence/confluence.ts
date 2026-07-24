import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import * as cheerio from 'cheerio'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseMultiValue, parseTagDate } from '@/connectors/utils'
import { getConfluenceCloudId, normalizeConfluenceDomainHost } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceConnector')

/** Label prefixes for Confluence's built-in Info/Note/Warning/Tip macros, by their rendered CSS suffix. */
const CALLOUT_LABELS: Record<string, string> = {
  information: '[INFO]',
  note: '[NOTE]',
  warning: '[WARNING]',
  tip: '[TIP]',
  error: '[ERROR]',
}

/**
 * Inline formatting tags whose text flows directly into their surrounding
 * sentence with no implied word break — e.g. `un<b>believe</b>able` must stay
 * `unbelievable`, and `Hello<b>!</b>` must stay `Hello!`, not gain an
 * artificial space. Anything not in this set (p, li, td, div, headings, br,
 * etc.) is treated as a block boundary that always implies a break, even when
 * the source HTML has no literal whitespace there.
 */
const INLINE_FORMATTING_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'ins',
  'sup',
  'sub',
  'small',
  'mark',
  'code',
  'span',
  'a',
  'abbr',
  'cite',
  'q',
  'kbd',
  'var',
  'samp',
  'time',
])

/**
 * Cheerio's `.text()` concatenates every descendant text node with no
 * separator at all, so pulling a macro body's text in one call fuses adjacent
 * blocks together (e.g. a `<p>...for:</p>` immediately followed by
 * `<li>GitLab</li>` becomes `for:GitLab`, corrupting the very word boundaries
 * RAG chunking depends on). Simply joining every text node with a space isn't
 * right either — that would corrupt genuinely inline-formatted text the same
 * way. This walks the DOM, accumulating text through inline tags without a
 * separator (preserving exact source adjacency) and flushing to a new segment
 * at every other tag boundary (a block always implies a break, regardless of
 * source whitespace) — matching how `html-parser.ts` already walks HTML for a
 * related reason elsewhere in this codebase, extended with the inline/block
 * distinction real Confluence rich text requires.
 */
function extractBlockJoinedText($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string {
  const parts: string[] = []
  let current = ''

  const flush = () => {
    const text = current.trim()
    if (text) parts.push(text)
    current = ''
  }

  const visit = ($node: cheerio.Cheerio<any>) => {
    $node.contents().each((_, child) => {
      if (child.type === 'text') {
        current += $(child).text()
      } else if (child.type === 'tag') {
        const tag = child.tagName?.toLowerCase()
        if (tag && INLINE_FORMATTING_TAGS.has(tag)) {
          visit($(child))
        } else {
          flush()
          visit($(child))
          flush()
        }
      }
    })
  }

  visit($el)
  flush()
  return parts.join(' ').trim()
}

/** Matches either flavor of panel/macro this function rewrites. */
const MACRO_SELECTOR = 'div.confluence-information-macro, div.panel'

/**
 * Confluence's rendered `view` HTML wraps Info/Note/Warning/Tip macros in
 * `confluence-information-macro confluence-information-macro-{type}` divs, and
 * the customizable Panel macro in `.panel` > `.panelHeader` + `.panelContent`
 * divs. `htmlToPlainText`'s blind tag-stripping discards the divs' classes along
 * with the tags, so a red "do not use" warning panel becomes indistinguishable
 * from a plain paragraph once flattened — and its trailing whitespace collapse
 * would erase any newline-based separation too. Each detected panel is rewritten
 * into a single bracketed label plus its own text so the callout semantic
 * survives both the tag strip and the whitespace collapse.
 *
 * A panel can itself contain another panel or macro (e.g. a nested Note inside
 * a Warning panel). Processing matches in document order — outermost first —
 * would read a not-yet-converted nested macro as plain body text before it
 * ever got its own label, silently dropping the inner callout's semantic, and
 * `.find('.panelHeader')` would then risk pulling a nested panel's header up
 * as if it were the outer panel's own title. Converting only "leaf" macros
 * (ones with no remaining nested macro/panel inside them) and repeating until
 * none are left processes innermost-first, so a nested macro is already a
 * bracketed `<p>` by the time its parent's body/header text is read — at which
 * point it correctly reads as plain text carrying its own label.
 */
export function preserveConfluenceCallouts(html: string): string {
  if (!html) return html

  const $ = cheerio.load(html)

  let progressed = true
  while (progressed) {
    progressed = false
    const leaves = $(MACRO_SELECTOR).filter((_, el) => $(el).find(MACRO_SELECTOR).length === 0)
    if (leaves.length === 0) break

    leaves.each((_, el) => {
      const $el = $(el)
      if ($el.hasClass('confluence-information-macro')) {
        const type = ($el.attr('class') ?? '')
          .match(/confluence-information-macro-(\w+)/)?.[1]
          ?.toLowerCase()
        const label = (type && CALLOUT_LABELS[type]) || CALLOUT_LABELS.information
        const macroBody = $el.find('.confluence-information-macro-body').first()
        const body = extractBlockJoinedText($, macroBody.length > 0 ? macroBody : $el)
        $el.replaceWith($('<p></p>').text(`${label} ${body}`))
      } else {
        const headerText = extractBlockJoinedText($, $el.find('.panelHeader').first())
        const panelContent = $el.find('.panelContent').first()
        const bodyText = extractBlockJoinedText($, panelContent.length > 0 ? panelContent : $el)
        const label = headerText ? `[CALLOUT: ${headerText}]` : '[CALLOUT]'
        $el.replaceWith($('<p></p>').text(`${label} ${bodyText}`))
      }
      progressed = true
    })
  }

  return $.html()
}

/**
 * Escapes a value for use inside CQL double-quoted strings.
 */
export function escapeCql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Keeps only content that is still current in Confluence. The v2
 * `/spaces/{id}/pages` endpoint includes `archived` pages by default and CQL has
 * no status filter, so without this guard archived pages stay in every listing,
 * keep getting upserted, and never fall out via deletion reconciliation (which
 * removes only documents absent from the listing). Items with no status field
 * are kept — only an explicit non-current status excludes a result.
 */
export function isCurrentContent(item: Record<string, unknown>): boolean {
  return item.status == null || item.status === 'current'
}

/**
 * Builds a CQL clause restricting content to the given space keys.
 * Single key uses `space = "X"`; multiple keys use `space in ("X","Y")`.
 */
function buildSpaceClause(spaceKeys: string[]): string {
  if (spaceKeys.length === 1) {
    return `space="${escapeCql(spaceKeys[0])}"`
  }
  const list = spaceKeys.map((k) => `"${escapeCql(k)}"`).join(',')
  return `space in (${list})`
}

/**
 * Fetches labels for a batch of page IDs using the v2 labels endpoint.
 */
const LABEL_FETCH_CONCURRENCY = 5

async function fetchLabelsForPages(
  cloudId: string,
  accessToken: string,
  pageIds: string[]
): Promise<Map<string, string[]>> {
  const labelsByPageId = new Map<string, string[]>()

  for (let i = 0; i < pageIds.length; i += LABEL_FETCH_CONCURRENCY) {
    const batch = pageIds.slice(i, i + LABEL_FETCH_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (pageId) => {
        try {
          let data: Record<string, unknown> | null = null
          for (const contentType of ['pages', 'blogposts']) {
            const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/${contentType}/${pageId}/labels`
            const response = await fetchWithRetry(url, {
              method: 'GET',
              headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
            })

            if (response.ok) {
              data = await response.json()
              break
            }
            if (response.status !== 404) {
              logger.warn(`Failed to fetch labels for ${contentType} ${pageId}`, {
                status: response.status,
              })
            }
          }

          if (!data) {
            return { pageId, labels: [] as string[] }
          }

          const labels = ((data.results as Record<string, unknown>[]) || []).map(
            (label) => label.name as string
          )
          return { pageId, labels }
        } catch (error) {
          logger.warn(`Error fetching labels for page ${pageId}`, {
            error: toError(error).message,
          })
          return { pageId, labels: [] as string[] }
        }
      })
    )

    for (const { pageId, labels } of results) {
      labelsByPageId.set(pageId, labels)
    }
  }

  return labelsByPageId
}

/**
 * Body representation marker embedded in the contentHash. Bumping this
 * invalidates every previously-synced Confluence document so a one-time
 * re-hydration picks up content newly reachable by the current extraction
 * (e.g. the switch from `storage` to rendered `view`, which expands Include
 * Page / Excerpt macros; or `preserveConfluenceCallouts`, which stops
 * flattening panel/info/note/warning/tip macros into indistinguishable plain
 * text). Without it, already-indexed pages whose version is unchanged
 * classify as `unchanged` and keep their stale (pre-fix) content.
 */
const CONTENT_REPRESENTATION = 'view-callouts'

/**
 * Produces a canonical metadata stub with a deterministic contentHash that
 * does not depend on which API surface (v1 CQL or v2) returned the page.
 */
function pageToStub(
  page: Record<string, unknown>,
  options: {
    spaceId?: unknown
    labels?: string[]
    sourceUrl?: string
  } = {}
): ExternalDocument {
  const version = page.version as Record<string, unknown> | undefined
  const versionNumber = version?.number as number | undefined
  const lastModified = (version?.createdAt ?? version?.when ?? '') as string
  const versionKey = versionNumber ?? lastModified

  return {
    externalId: String(page.id),
    title: (page.title as string) || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: options.sourceUrl,
    contentHash: `confluence:${CONTENT_REPRESENTATION}:${page.id}:${versionKey}`,
    metadata: {
      spaceId: options.spaceId,
      status: page.status,
      version: versionNumber,
      labels: options.labels ?? [],
      lastModified,
    },
  }
}

/**
 * Converts a v1 CQL search result item to a lightweight metadata stub.
 */
function cqlResultToStub(item: Record<string, unknown>, domain: string): ExternalDocument {
  const links = item._links as Record<string, string> | undefined
  const metadata = item.metadata as Record<string, unknown> | undefined
  const labelsWrapper = metadata?.labels as Record<string, unknown> | undefined
  const labelResults = (labelsWrapper?.results || []) as Record<string, unknown>[]
  const labels = labelResults.map((l) => l.name as string)

  return pageToStub(item, {
    spaceId: (item.space as Record<string, unknown>)?.key,
    labels,
    sourceUrl: links?.webui ? `https://${domain}/wiki${links.webui}` : undefined,
  })
}

export const confluenceConnector: ConnectorConfig = {
  ...confluenceConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const domain = normalizeConfluenceDomainHost(sourceConfig.domain as string)
    const spaceKeys = parseMultiValue(sourceConfig.spaceKey)
    const contentType = (sourceConfig.contentType as string) || 'page'
    const labelFilter = (sourceConfig.labelFilter as string) || ''
    const maxPages = sourceConfig.maxPages ? Number(sourceConfig.maxPages) : 0

    if (spaceKeys.length === 0) {
      throw new Error('At least one space key is required')
    }

    let cloudId = syncContext?.cloudId as string | undefined
    if (!cloudId) {
      cloudId = await getConfluenceCloudId(domain, accessToken)
      if (syncContext) syncContext.cloudId = cloudId
    }

    /**
     * Route through CQL when a label filter is set or when multiple spaces are
     * selected — the v2 `/spaces/{spaceId}/pages` endpoint is single-space only,
     * but CQL natively supports `space in (...)`.
     */
    if (labelFilter.trim() || spaceKeys.length > 1) {
      return listDocumentsViaCql(
        cloudId,
        accessToken,
        domain,
        spaceKeys,
        contentType,
        labelFilter,
        maxPages,
        cursor,
        syncContext
      )
    }

    const spaceKey = spaceKeys[0]
    let spaceId = syncContext?.spaceId as string | undefined
    if (!spaceId) {
      spaceId = await resolveSpaceId(cloudId, accessToken, spaceKey)
      if (syncContext) syncContext.spaceId = spaceId
    }

    if (contentType === 'all') {
      return listAllContentTypes(
        cloudId,
        accessToken,
        domain,
        spaceId,
        spaceKey,
        maxPages,
        cursor,
        syncContext
      )
    }

    return listDocumentsV2(
      cloudId,
      accessToken,
      domain,
      spaceId,
      spaceKey,
      contentType,
      maxPages,
      cursor,
      syncContext
    )
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const domain = normalizeConfluenceDomainHost(sourceConfig.domain as string)
    let cloudId = syncContext?.cloudId as string | undefined
    if (!cloudId) {
      cloudId = await getConfluenceCloudId(domain, accessToken)
      if (syncContext) syncContext.cloudId = cloudId
    }

    /**
     * Fetch the `view` representation rather than `storage`. Storage format only
     * carries unexpanded macro references (e.g. Include Page / Excerpt Include),
     * so "mirrored" content that pulls in another page's body is stripped to
     * nothing by `htmlToPlainText`. The `view` representation is server-rendered
     * HTML with those macros expanded inline, so included content is indexed too.
     * The v2 single-item GET (`/pages/{id}`, `/blogposts/{id}`) supports
     * `body-format=view`; only the bulk list endpoints are limited to storage/adf.
     */
    let page: Record<string, unknown> | null = null
    for (const endpoint of ['pages', 'blogposts']) {
      const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/${endpoint}/${externalId}?body-format=view`
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (response.ok) {
        page = await response.json()
        break
      }
      if (response.status !== 404) {
        throw new Error(`Failed to get Confluence content: ${response.status}`)
      }
    }

    if (!page || !isCurrentContent(page)) return null
    const body = page.body as Record<string, unknown> | undefined
    const view = body?.view as Record<string, unknown> | undefined
    const rawContent = (view?.value as string) || ''
    const plainText = htmlToPlainText(preserveConfluenceCallouts(rawContent))

    const labelMap = await fetchLabelsForPages(cloudId, accessToken, [String(page.id)])
    const labels = labelMap.get(String(page.id)) ?? []

    const links = page._links as Record<string, unknown> | undefined
    const stub = pageToStub(page, {
      spaceId: page.spaceId,
      labels,
      sourceUrl: links?.webui ? `https://${domain}/wiki${links.webui}` : undefined,
    })

    return {
      ...stub,
      content: plainText,
      contentDeferred: false,
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const domain = sourceConfig.domain as string
    const spaceKeys = parseMultiValue(sourceConfig.spaceKey)

    if (!domain || spaceKeys.length === 0) {
      return { valid: false, error: 'Domain and at least one space key are required' }
    }

    const maxPages = sourceConfig.maxPages as string | undefined
    if (maxPages && (Number.isNaN(Number(maxPages)) || Number(maxPages) <= 0)) {
      return { valid: false, error: 'Max pages must be a positive number' }
    }

    try {
      const cloudId = await getConfluenceCloudId(domain, accessToken, VALIDATE_RETRY_OPTIONS)
      const params = new URLSearchParams()
      for (const key of spaceKeys) params.append('keys', key)
      params.append('limit', String(Math.max(spaceKeys.length, 1)))
      const spaceUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/spaces?${params.toString()}`
      const response = await fetchWithRetry(
        spaceUrl,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )
      if (!response.ok) {
        return { valid: false, error: `Failed to validate spaces: ${response.status}` }
      }
      const data = await response.json()
      const results = (data.results as Array<Record<string, unknown>> | undefined) ?? []
      const foundKeys = new Set(results.map((r) => String(r.key)))
      const missing = spaceKeys.filter((k) => !foundKeys.has(k))
      if (missing.length > 0) {
        return {
          valid: false,
          error: `Space${missing.length > 1 ? 's' : ''} not found: ${missing.join(', ')}`,
        }
      }
      return { valid: true }
    } catch (error) {
      return { valid: false, error: toError(error).message || 'Failed to validate configuration' }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const joined = joinTagArray(metadata.labels)
    if (joined) result.labels = joined

    if (metadata.version != null) {
      const num = Number(metadata.version)
      if (!Number.isNaN(num)) result.version = num
    }

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}

/**
 * Lists documents using the v2 API for a single content type (pages or blogposts).
 */
async function listDocumentsV2(
  cloudId: string,
  accessToken: string,
  domain: string,
  spaceId: string,
  spaceKey: string,
  contentType: string,
  maxPages: number,
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const queryParams = new URLSearchParams()
  queryParams.append('limit', '250')
  /**
   * Restrict to current content: the pages endpoint defaults to
   * `current,archived`, so archived pages would otherwise stay in the listing
   * forever and never be purged by deletion reconciliation.
   */
  queryParams.append('status', 'current')
  if (cursor) {
    queryParams.append('cursor', cursor)
  }

  const endpoint = contentType === 'blogpost' ? 'blogposts' : 'pages'
  const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/spaces/${spaceId}/${endpoint}?${queryParams.toString()}`

  logger.info(`Listing ${endpoint} in space ${spaceKey} (ID: ${spaceId})`)

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`Failed to list Confluence ${endpoint}`, {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to list Confluence ${endpoint}: ${response.status}`)
  }

  const data = await response.json()
  const results = data.results || []

  const documents: ExternalDocument[] = (results as Record<string, unknown>[])
    .filter(isCurrentContent)
    .map((page) => {
      const links = page._links as Record<string, string> | undefined
      return pageToStub(page, {
        spaceId: page.spaceId,
        sourceUrl: links?.webui ? `https://${domain}/wiki${links.webui}` : undefined,
      })
    })

  let nextCursor: string | undefined
  const nextLink = (data._links as Record<string, string>)?.next
  if (nextLink) {
    try {
      nextCursor = new URL(nextLink, 'https://placeholder').searchParams.get('cursor') || undefined
    } catch {
      // Ignore malformed URLs
    }
  }

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  if (hitLimit && syncContext) syncContext.listingCapped = true

  return {
    documents,
    nextCursor: hitLimit ? undefined : nextCursor,
    hasMore: hitLimit ? false : Boolean(nextCursor),
  }
}

/**
 * Lists both pages and blogposts using a compound cursor that tracks
 * pagination state for each content type independently.
 */
async function listAllContentTypes(
  cloudId: string,
  accessToken: string,
  domain: string,
  spaceId: string,
  spaceKey: string,
  maxPages: number,
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  let pageCursor: string | undefined
  let blogCursor: string | undefined
  let pagesDone = false
  let blogsDone = false

  if (cursor) {
    try {
      const parsed = JSON.parse(cursor)
      pageCursor = parsed.page
      blogCursor = parsed.blog
      pagesDone = parsed.pagesDone === true
      blogsDone = parsed.blogsDone === true
    } catch {
      /**
       * Older bare-string cursors are no longer emitted; fall through and
       * restart instead of silently re-listing blogposts from page 0.
       */
      logger.warn('Ignoring unparseable Confluence cursor; restarting listing')
    }
  }

  const results: ExternalDocumentList = { documents: [], hasMore: false }

  if (!pagesDone) {
    const pagesResult = await listDocumentsV2(
      cloudId,
      accessToken,
      domain,
      spaceId,
      spaceKey,
      'page',
      maxPages,
      pageCursor,
      syncContext
    )
    results.documents.push(...pagesResult.documents)
    pageCursor = pagesResult.nextCursor
    pagesDone = !pagesResult.hasMore
  }

  if (!blogsDone) {
    const blogResult = await listDocumentsV2(
      cloudId,
      accessToken,
      domain,
      spaceId,
      spaceKey,
      'blogpost',
      maxPages,
      blogCursor,
      syncContext
    )
    results.documents.push(...blogResult.documents)
    blogCursor = blogResult.nextCursor
    blogsDone = !blogResult.hasMore
  }

  results.hasMore = !pagesDone || !blogsDone

  if (results.hasMore) {
    results.nextCursor = JSON.stringify({
      page: pageCursor,
      blog: blogCursor,
      pagesDone,
      blogsDone,
    })
  }

  return results
}

/**
 * Lists documents using CQL search via the v1 API (used when label filtering is enabled).
 */
async function listDocumentsViaCql(
  cloudId: string,
  accessToken: string,
  domain: string,
  spaceKeys: string[],
  contentType: string,
  labelFilter: string,
  maxPages: number,
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const labels = labelFilter
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)

  // Build CQL query
  let cql = buildSpaceClause(spaceKeys)

  if (contentType === 'blogpost') {
    cql += ' AND type="blogpost"'
  } else if (contentType === 'page' || !contentType) {
    cql += ' AND type="page"'
  }
  // contentType === 'all' — no type filter

  if (labels.length === 1) {
    cql += ` AND label="${escapeCql(labels[0])}"`
  } else if (labels.length > 1) {
    const labelList = labels.map((l) => `"${escapeCql(l)}"`).join(',')
    cql += ` AND label in (${labelList})`
  }

  const limit = maxPages > 0 ? Math.min(maxPages, 50) : 50
  const start = cursor ? Number(cursor) : 0

  const queryParams = new URLSearchParams()
  queryParams.append('cql', cql)
  queryParams.append('limit', String(limit))
  queryParams.append('start', String(start))
  queryParams.append('expand', 'version,metadata.labels')

  const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/content/search?${queryParams.toString()}`

  logger.info(`Searching Confluence via CQL: ${cql}`, { start, limit })

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Failed to search Confluence via CQL', {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to search Confluence via CQL: ${response.status}`)
  }

  const data = await response.json()
  const results = data.results || []

  const documents: ExternalDocument[] = (results as Record<string, unknown>[])
    .filter(isCurrentContent)
    .map((item) => cqlResultToStub(item, domain))

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  if (hitLimit && syncContext) syncContext.listingCapped = true

  const totalSize = (data.totalSize as number) ?? 0
  const nextStart = start + results.length
  const hasMore = !hitLimit && nextStart < totalSize

  return {
    documents,
    nextCursor: hasMore ? String(nextStart) : undefined,
    hasMore,
  }
}

/**
 * Resolves a Confluence space key to its numeric space ID.
 */
async function resolveSpaceId(
  cloudId: string,
  accessToken: string,
  spaceKey: string
): Promise<string> {
  const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to resolve space key "${spaceKey}": ${response.status}`)
  }

  const data = await response.json()
  const results = data.results || []

  if (results.length === 0) {
    throw new Error(`Space "${spaceKey}" not found`)
  }

  return String(results[0].id)
}
