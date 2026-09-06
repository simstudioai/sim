import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import * as cheerio from 'cheerio'
import {
  AtlassianSiteNotAccessibleError,
  AtlassianSiteNotMatchedError,
} from '@/lib/atlassian/discovery'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  type ConfluenceRestriction,
  confluencePageAcl,
} from '@/lib/knowledge/access/confluence-permissions'
import type { MirroredDocumentAcl } from '@/lib/knowledge/access/types'
import {
  createRetryableHttpError,
  fetchWithRetry,
  type RetryOptions,
  VALIDATE_RETRY_OPTIONS,
} from '@/lib/knowledge/documents/utils'
import { extractCursor } from '@/connectors/confluence/cursor'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import {
  describeContent,
  getReadRestriction,
  listAncestorIds,
  listSpaceReadPrincipals,
  openConfluenceDirectory,
} from '@/connectors/confluence/permissions'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseMultiValue, parseTagDate } from '@/connectors/utils'
import { getConfluenceCloudId, normalizeConfluenceDomainHost } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceConnector')

/**
 * The configured space does not exist for the caller. Confluence answers a
 * space lookup with an empty result rather than a 403 when the caller cannot
 * see the space, so this is also what a member without access observes.
 */
export class ConfluenceSpaceNotFoundError extends Error {
  constructor(readonly spaceKey: string) {
    super(`Space "${spaceKey}" not found`)
    this.name = 'ConfluenceSpaceNotFoundError'
  }
}

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
      } else if (child.type === 'cdata') {
        current += $(child.children).text()
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

const STORAGE_MACRO_SELECTOR = 'ac\\:structured-macro, ac\\:macro'
const LOCAL_STORAGE_MACROS = new Set([
  'info',
  'note',
  'warning',
  'tip',
  'panel',
  'expand',
  'excerpt',
  'code',
  'noformat',
])

/**
 * Search authorizes the containing page, not content expanded from another
 * resource. Read authored storage text and known local macro bodies only;
 * inclusion and third-party macros may render differently for each reader.
 */
export function confluenceStorageToPlainText(storage: string): string {
  const $ = cheerio.load(
    storage,
    { xml: { xmlMode: false, recognizeCDATA: true, recognizeSelfClosing: true } },
    false
  )
  $('ac\\:adf-extension').remove()

  $(STORAGE_MACRO_SELECTOR).each((_, element) => {
    if (!LOCAL_STORAGE_MACROS.has($(element).attr('ac:name') ?? '')) {
      $(element).remove()
    }
  })

  for (const element of $(STORAGE_MACRO_SELECTOR).toArray().reverse()) {
    const macro = $(element)
    const name = macro.attr('ac:name') ?? ''
    const title = macro.children('ac\\:parameter[ac\\:name="title"]').text().trim()
    const body = extractBlockJoinedText(
      $,
      macro.children('ac\\:rich-text-body, ac\\:plain-text-body')
    )
    const label =
      name === 'panel'
        ? title
          ? `[CALLOUT: ${title}]`
          : '[CALLOUT]'
        : CALLOUT_LABELS[name === 'info' ? 'information' : name]
    const text = [label, name === 'panel' ? '' : title, body].filter(Boolean).join(' ')
    macro.replaceWith($('<p></p>').text(text))
  }

  $('ac\\:parameter, ac\\:default-parameter, script, style').remove()
  return extractBlockJoinedText($, $.root()).replace(/\s+/g, ' ').trim()
}

function usesPermissionScopedContent(syncContext?: Record<string, unknown>): boolean {
  return syncContext?.perMemberListing === true || syncContext?.mirrorsSourceAcls === true
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
 * Reads the `labels` field returned by the v2 single-content GET when
 * `include-labels=true` is set, which removes the need for a second round trip
 * to `/{type}/{id}/labels`. That embedded list is capped at 50 labels (the
 * dedicated endpoint defaulted to 25), so this widens rather than narrows what
 * a page can report; labels beyond the cap are paginated behind
 * `labels._links` and are deliberately not followed.
 */
export function readIncludedLabels(page: Record<string, unknown>): string[] {
  const wrapper = page.labels as Record<string, unknown> | undefined
  const results = (wrapper?.results as Record<string, unknown>[] | undefined) ?? []
  return results.map((label) => String(label.name ?? '')).filter(Boolean)
}

/**
 * Body representation marker embedded in the contentHash. Bumping this
 * causes the next complete listing to rehydrate pages even if their version
 * is unchanged. Search must replace rendered inclusions with authored content;
 * ordinary knowledge bases retain their existing rendered representation.
 */
const CONTENT_REPRESENTATION = 'view-callouts'
const SCOPED_CONTENT_REPRESENTATION = 'storage-local-body-v1'

/**
 * Produces a canonical metadata stub with a deterministic contentHash that
 * does not depend on which API surface (v1 CQL or v2) returned the page.
 */
function pageToStub(
  page: Record<string, unknown>,
  options: {
    spaceId?: unknown
    /** The space's key, which the permission pass resolves the page's space from. */
    spaceKey?: string
    /** `page` or `blogpost`; only a page has ancestors to inherit restrictions from. */
    contentType?: string
    labels?: string[]
    sourceUrl?: string
  } = {},
  syncContext?: Record<string, unknown>
): ExternalDocument {
  const version = page.version as Record<string, unknown> | undefined
  const versionNumber = version?.number as number | undefined
  const lastModified = (version?.createdAt ?? version?.when ?? '') as string
  const versionKey = versionNumber ?? lastModified
  const representation = usesPermissionScopedContent(syncContext)
    ? SCOPED_CONTENT_REPRESENTATION
    : CONTENT_REPRESENTATION

  return {
    externalId: String(page.id),
    title: (page.title as string) || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: options.sourceUrl,
    contentHash: `confluence:${representation}:${page.id}:${versionKey}`,
    metadata: {
      spaceId: options.spaceId,
      spaceKey: options.spaceKey,
      contentType: options.contentType,
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
function cqlResultToStub(
  item: Record<string, unknown>,
  domain: string,
  syncContext?: Record<string, unknown>
): ExternalDocument {
  const links = item._links as Record<string, string> | undefined
  const metadata = item.metadata as Record<string, unknown> | undefined
  const labelsWrapper = metadata?.labels as Record<string, unknown> | undefined
  const labelResults = (labelsWrapper?.results || []) as Record<string, unknown>[]
  const labels = labelResults.map((l) => l.name as string)

  const spaceKey = (item.space as Record<string, unknown>)?.key
  return pageToStub(
    item,
    {
      spaceId: spaceKey,
      spaceKey: typeof spaceKey === 'string' ? spaceKey : undefined,
      contentType: typeof item.type === 'string' ? item.type : undefined,
      labels,
      sourceUrl: links?.webui ? `https://${domain}/wiki${links.webui}` : undefined,
    },
    syncContext
  )
}

/**
 * The site's cloud id, memoised on the run so it is discovered once per sync
 * rather than once per call — and taken from the credential where a service
 * account already carries it, since its API token cannot call
 * `accessible-resources` to discover one.
 */
async function resolveCloudId(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  syncContext?: Record<string, unknown>,
  retryOptions?: RetryOptions
): Promise<string> {
  const cached = syncContext?.cloudId
  if (typeof cached === 'string' && cached) return cached
  const domain = normalizeConfluenceDomainHost(sourceConfig.domain as string)
  const cloudId = await getConfluenceCloudId(domain, accessToken, retryOptions)
  if (syncContext) syncContext.cloudId = cloudId
  return cloudId
}

/**
 * The provider segment of every Confluence group token. Fixed, and baked into
 * stored ACLs, so it must never change.
 */
const CONFLUENCE_ACL_PROVIDER_ID = 'confluence'

/**
 * One in-flight promise per key, so a value fetched for one page is shared by
 * every other page that needs it — an ancestor's restriction is consulted by
 * all its descendants, and a space's readers by every page in it.
 */
function memoizeAsync<K, V>(load: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>()
  return (key: K) => {
    let pending = cache.get(key)
    if (!pending) {
      pending = load(key)
      cache.set(key, pending)
    }
    return pending
  }
}

/** Pages whose restrictions are resolved at once. Bounded to keep a crawl responsive. */
const ACL_CONCURRENCY = 8

/** Where a listed piece of content lives, as the permission pass needs it. */
interface ContentLocation {
  spaceId: string
  contentType: string
}

/**
 * Resolves who may read each listed page.
 *
 * Confluence reports a page's restrictions only when asked for that page, so
 * unlike Drive this cannot ride along with the listing. Two things are cached
 * for the batch: each space's read principals and each page's restriction,
 * which may be consulted by many descendants.
 *
 * A page falls back to *its own* space's readers, never the union of every
 * configured space: a connector over two spaces must not let a reader of one
 * into the unrestricted pages of the other.
 *
 * A page whose restrictions could not be read this run is omitted, which the
 * engine stores as readable by nobody, and the rest of the batch still
 * resolves — the same per-document containment Drive has.
 */
async function resolveConfluenceAcls(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  documents: readonly ExternalDocument[],
  syncContext?: Record<string, unknown>
): Promise<Record<string, MirroredDocumentAcl>> {
  const cloudId = await resolveCloudId(accessToken, sourceConfig, syncContext)

  const spaceIdForKey = memoizeAsync((spaceKey: string) =>
    resolveSpaceId(cloudId, accessToken, spaceKey)
  )
  const spacePrincipalsFor = memoizeAsync((spaceId: string) =>
    listSpaceReadPrincipals(cloudId, accessToken, spaceId)
  )
  const readRestriction = memoizeAsync((contentId: string) =>
    getReadRestriction(cloudId, accessToken, contentId)
  )

  /** The listing usually says where a page lives; anything it did not describe is asked. */
  const locate = async (doc: ExternalDocument): Promise<ContentLocation | null> => {
    const spaceKey = doc.metadata?.spaceKey
    const contentType = doc.metadata?.contentType
    if (typeof spaceKey === 'string' && spaceKey) {
      return {
        spaceId: await spaceIdForKey(spaceKey),
        contentType: typeof contentType === 'string' ? contentType : 'page',
      }
    }
    return describeContent(cloudId, accessToken, doc.externalId)
  }

  /** One entry per page whose permissions this run could read in full. */
  const resolved = new Map<string, { spaceId: string; chain: ConfluenceRestriction[] }>()
  let unreadable = 0
  await mapWithConcurrency(documents, ACL_CONCURRENCY, async (doc) => {
    const externalId = doc.externalId
    try {
      const location = await locate(doc)
      if (!location) {
        unreadable += 1
        return
      }
      const own = await readRestriction(externalId)
      /**
       * Every ancestor restriction still applies when the page has its own.
       * A blog post has no ancestors to inherit from.
       */
      const chain: ConfluenceRestriction[] = [own]
      if (location.contentType !== 'blogpost') {
        for (const ancestorId of await listAncestorIds(cloudId, accessToken, externalId)) {
          const restriction = await readRestriction(ancestorId)
          chain.push(restriction)
        }
      }
      await spacePrincipalsFor(location.spaceId)
      resolved.set(externalId, { spaceId: location.spaceId, chain })
    } catch (error) {
      unreadable += 1
      logger.warn("Could not read a page's permissions; it stays readable by nobody", {
        cloudId,
        externalId,
        error: getErrorMessage(error),
      })
    }
  })

  const acls: Record<string, MirroredDocumentAcl> = {}
  for (const [externalId, { spaceId, chain }] of resolved) {
    const result = confluencePageAcl({
      spacePrincipals: await spacePrincipalsFor(spaceId),
      restrictionChain: chain,
      providerId: CONFLUENCE_ACL_PROVIDER_ID,
      tenantId: cloudId,
    })
    acls[externalId] =
      result.requirements.length > 0
        ? { acl: result.acl, requirements: result.requirements }
        : result.acl
  }

  if (unreadable > 0) {
    logger.warn('Some Confluence pages had unreadable permissions and stay readable by nobody', {
      cloudId,
      unreadable,
    })
  }
  return acls
}

export const confluenceConnector: ConnectorConfig = {
  isCredentialInvalidError: (error) =>
    error instanceof Error && 'status' in error && error.status === 401,
  ...confluenceConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const domain = normalizeConfluenceDomainHost(sourceConfig.domain as string)
    const spaceKeys = parseMultiValue(sourceConfig.spaceKey)
    const contentType = (sourceConfig.contentType as string) || 'page'
    const labelFilter = (sourceConfig.labelFilter as string) || ''
    const maxPages = sourceConfig.maxPages ? Number(sourceConfig.maxPages) : 0

    if (spaceKeys.length === 0) {
      throw new Error('At least one space key is required')
    }

    const cloudId = await resolveCloudId(accessToken, sourceConfig, syncContext)

    /**
     * Route through CQL when a label filter is set, when multiple spaces are
     * selected, or when only recently modified content is wanted — the v2
     * `/spaces/{spaceId}/pages` endpoint is single-space only and cannot filter
     * by modification time, but CQL natively supports `space in (...)` and
     * `lastModified`.
     */
    if (labelFilter.trim() || spaceKeys.length > 1 || lastSyncAt) {
      return listDocumentsViaCql(
        cloudId,
        accessToken,
        domain,
        spaceKeys,
        contentType,
        labelFilter,
        maxPages,
        cursor,
        syncContext,
        lastSyncAt
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

  getDocumentAcls: resolveConfluenceAcls,

  openDirectory: async (accessToken, sourceConfig, syncContext) =>
    openConfluenceDirectory(
      CONFLUENCE_ACL_PROVIDER_ID,
      await resolveCloudId(accessToken, sourceConfig, syncContext),
      accessToken
    ),

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const domain = normalizeConfluenceDomainHost(sourceConfig.domain as string)
    const cloudId = await resolveCloudId(accessToken, sourceConfig, syncContext)

    const scopedContent = usesPermissionScopedContent(syncContext)
    const bodyFormat = scopedContent ? 'storage' : 'view'
    let page: Record<string, unknown> | null = null
    for (const endpoint of ['pages', 'blogposts']) {
      const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/${endpoint}/${encodeURIComponent(externalId)}?body-format=${bodyFormat}&include-labels=true`
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
      if (response.status === 401) throw await createRetryableHttpError(response)
      if (response.status !== 404) {
        throw new Error(`Failed to get Confluence content: ${response.status}`)
      }
    }

    if (!page || !isCurrentContent(page)) return null
    const body = page.body as Record<string, unknown> | undefined
    const representation = body?.[bodyFormat] as Record<string, unknown> | undefined
    if (scopedContent && typeof representation?.value !== 'string') {
      throw new Error('Confluence content is missing its storage body')
    }
    const rawContent = (representation?.value as string) || ''
    const plainText = scopedContent
      ? confluenceStorageToPlainText(rawContent)
      : htmlToPlainText(preserveConfluenceCallouts(rawContent))

    const links = page._links as Record<string, unknown> | undefined
    const stub = pageToStub(
      page,
      {
        spaceId: page.spaceId,
        labels: readIncludedLabels(page),
        sourceUrl: links?.webui ? `https://${domain}/wiki${links.webui}` : undefined,
      },
      syncContext
    )

    return {
      ...stub,
      content: plainText,
      contentDeferred: false,
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    syncContext?: Record<string, unknown>
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
      const cloudId = await resolveCloudId(
        accessToken,
        sourceConfig,
        syncContext,
        VALIDATE_RETRY_OPTIONS
      )
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
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
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

  /**
   * A member who is not on the Atlassian site — their token reaches no site,
   * or only sites other than the configured one — or who cannot see the
   * configured space, lists nothing: a complete listing of nothing, not an error.
   */
  isListingScopeUnavailableError: (error) =>
    error instanceof ConfluenceSpaceNotFoundError ||
    error instanceof AtlassianSiteNotAccessibleError ||
    error instanceof AtlassianSiteNotMatchedError,
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
    if (response.status === 401) throw await createRetryableHttpError(response)
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
      return pageToStub(
        page,
        {
          spaceId: page.spaceId,
          spaceKey,
          contentType,
          sourceUrl: links?.webui ? `https://${domain}/wiki${links.webui}` : undefined,
        },
        syncContext
      )
    })

  const nextCursor = extractCursor((data._links as Record<string, unknown> | undefined)?.next)

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  /**
   * Only a cap that actually truncates a listing may suppress deletion
   * reconciliation. When the source is exhausted (no next cursor) the listing is
   * complete even though the count reached `maxPages`, and flagging it would
   * permanently strand documents deleted upstream.
   */
  if (hitLimit && nextCursor && syncContext) syncContext.listingCapped = true

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
 * The CQL clause selecting content modified since a watermark. CQL's `now()`
 * takes a relative offset and evaluates on the server, which sidesteps the
 * timezone the endpoint would otherwise assume for an absolute timestamp; the
 * offset rounds up to the next whole minute so nothing at the edge is missed.
 */
export function buildLastModifiedClause(lastSyncAt: Date, now: Date): string {
  const minutes = Math.max(1, Math.ceil((now.getTime() - lastSyncAt.getTime()) / 60_000))
  return `lastModified >= now("-${minutes}m")`
}

/**
 * The `lastModified` clause every page of one listing shares. The clause is a
 * window relative to the server clock, so recomputing it on a later page that
 * crosses a minute boundary would pair the cursor `_links.next` issued with a
 * query it was not issued for; the first page fixes it for the run.
 */
export function resolveLastModifiedClause(
  lastSyncAt: Date,
  syncContext: Record<string, unknown> | undefined
): string {
  const fixed = syncContext?.cqlLastModifiedClause
  if (typeof fixed === 'string') return fixed
  const clause = buildLastModifiedClause(lastSyncAt, new Date())
  if (syncContext) syncContext.cqlLastModifiedClause = clause
  return clause
}

/**
 * Page size for CQL search. The endpoint defaults to 25 and documents no hard
 * maximum, so this stays conservatively below the fixed system limits it warns
 * about rather than mirroring the v2 endpoints' 250.
 */
const CQL_PAGE_SIZE = 50

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
  syncContext?: Record<string, unknown>,
  lastSyncAt?: Date
): Promise<ExternalDocumentList> {
  const labels = labelFilter
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)

  // Build CQL query
  let cql = buildSpaceClause(spaceKeys)

  if (contentType === 'blogpost') {
    cql += ' AND type="blogpost"'
  } else if (contentType === 'all') {
    /**
     * An unconstrained CQL search matches every content type the index holds —
     * attachments, comments, space descriptions and user profiles included — none
     * of which `getDocument` can resolve through the page/blogpost endpoints. "All
     * content" means both indexable content types, not literally everything.
     */
    cql += ' AND type in ("page","blogpost")'
  } else {
    cql += ' AND type="page"'
  }

  if (labels.length === 1) {
    cql += ` AND label="${escapeCql(labels[0])}"`
  } else if (labels.length > 1) {
    const labelList = labels.map((l) => `"${escapeCql(l)}"`).join(',')
    cql += ` AND label in (${labelList})`
  }

  if (lastSyncAt) cql += ` AND ${resolveLastModifiedClause(lastSyncAt, syncContext)}`

  const fetchedSoFar = (syncContext?.totalDocsFetched as number) ?? 0
  const remaining = maxPages > 0 ? maxPages - fetchedSoFar : Number.POSITIVE_INFINITY

  /**
   * The page size stays constant for every request of a run. This endpoint
   * paginates by opaque cursor, and Atlassian does not document that a cursor
   * issued against one `limit` stays valid when the following request asks for a
   * different one, so narrowing `limit` to the remaining budget risks skipping or
   * repeating results. The cap is applied by trimming the returned page instead.
   */
  const queryParams = new URLSearchParams()
  queryParams.append('cql', cql)
  queryParams.append('limit', String(CQL_PAGE_SIZE))
  queryParams.append('expand', 'version,metadata.labels')
  /**
   * `/wiki/rest/api/content/search` paginates by opaque cursor only — it has no
   * `start` parameter, and its response carries no total count. The next page is
   * reachable solely through the cursor embedded in `_links.next`.
   */
  if (cursor) queryParams.append('cursor', cursor)

  const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/content/search?${queryParams.toString()}`

  logger.info(`Searching Confluence via CQL: ${cql}`, {
    limit: CQL_PAGE_SIZE,
    hasCursor: Boolean(cursor),
  })

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    if (response.status === 401) throw await createRetryableHttpError(response)
    const errorText = await response.text()
    logger.error('Failed to search Confluence via CQL', {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to search Confluence via CQL: ${response.status}`)
  }

  const data = await response.json()
  const results = data.results || []

  const allDocuments: ExternalDocument[] = (results as Record<string, unknown>[])
    .filter(isCurrentContent)
    .map((item) => cqlResultToStub(item, domain, syncContext))

  /**
   * Trim to the remaining budget. Trimming stops the walk (`hitLimit` below is
   * then true), so the discarded tail is never skipped over — the run simply
   * ends here.
   */
  const documents =
    allDocuments.length > remaining ? allDocuments.slice(0, remaining) : allDocuments
  const trimmedByCap = documents.length < allDocuments.length

  const nextCursor = extractCursor((data._links as Record<string, unknown> | undefined)?.next)

  const totalFetched = fetchedSoFar + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  /**
   * Both truncation shapes count: pages this run trimmed off, and a page left
   * unread behind a live cursor. A cap that lands exactly on source exhaustion
   * is a complete listing and must still reconcile deletions.
   */
  if (hitLimit && (trimmedByCap || nextCursor) && syncContext) syncContext.listingCapped = true

  const hasMore = !hitLimit && Boolean(nextCursor)

  return {
    documents,
    nextCursor: hasMore ? nextCursor : undefined,
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
    if (response.status === 401) throw await createRetryableHttpError(response)
    throw new Error(`Failed to resolve space key "${spaceKey}": ${response.status}`)
  }

  const data = await response.json()
  const results = data.results || []

  if (results.length === 0) {
    throw new ConfluenceSpaceNotFoundError(spaceKey)
  }

  return String(results[0].id)
}
