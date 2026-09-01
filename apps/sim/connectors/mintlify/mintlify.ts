import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { validateExternalUrl } from '@/lib/core/security/input-validation'
import {
  type SecureFetchRetryOptions,
  secureFetchWithRetry,
} from '@/lib/knowledge/documents/secure-fetch.server'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  DEFAULT_MAX_PAGES,
  MAX_PAGES_LIMIT,
  mintlifyConnectorMeta,
} from '@/connectors/mintlify/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, htmlToPlainText } from '@/connectors/utils'

const logger = createLogger('MintlifyConnector')

/** Documents returned per `listDocuments` call. */
const DOCS_PER_PAGE = 50

/** Byte cap for the page-index file (`llms.txt` / `sitemap.xml`) of a user-supplied host. */
const INDEX_MAX_BYTES = 5 * 1024 * 1024

/** Byte cap for a single documentation page body. */
const PAGE_MAX_BYTES = 1024 * 1024

/** Child sitemaps followed from a `<sitemapindex>`, bounding a hostile or huge index. */
const MAX_CHILD_SITEMAPS = 20

/**
 * Bound on `<loc>` entries accumulated across a sitemap index.
 *
 * {@link INDEX_MAX_BYTES} caps each sitemap document individually, but a
 * `<sitemapindex>` multiplies that by {@link MAX_CHILD_SITEMAPS}, so the merged
 * location list is the largest allocation on the discovery path and the only one
 * not bounded by a single document's size. Hitting this cap truncates the
 * listing, so it reports `truncated`.
 */
const MAX_SITEMAP_LOCATIONS = 50_000

/**
 * Character cap Mintlify applies to the `llms.txt` it generates: "Automatically
 * generated `llms.txt` files cannot exceed 100,000 characters. If your
 * documentation exceeds this limit, Mintlify truncates the file and appends a
 * note listing the number of omitted pages."
 * (https://mintlify.com/docs/ai/llmstxt)
 *
 * A truncated index is a partial listing the sync engine cannot distinguish from
 * deletions, so a body at or near the cap must suppress deletion reconciliation.
 * The exact wording of the appended note is not published, so it is deliberately
 * not matched — the documented length is the only reliable signal.
 */
const LLMS_TXT_MAX_CHARS = 100_000

/**
 * Margin below {@link LLMS_TXT_MAX_CHARS} that still counts as truncated.
 *
 * Mintlify publishes the cap but not where it cuts, so the delivered body is
 * assumed to land near — not exactly at — 100,000 characters (a cut at an entry
 * boundary, plus the appended note). The margin absorbs that unknown. Erring
 * wide costs a complete-but-large index its deletion reconciliation, which a
 * forced full sync can still override; erring narrow would hard-delete the pages
 * a truncated index omitted, which nothing recovers. Hence the generous margin.
 */
const LLMS_TXT_TRUNCATION_MARGIN = 5_000

/** A discovered page set plus whether the source index itself was incomplete. */
interface MintlifyDiscovery {
  pages: MintlifyPageLink[]
  /** The index was cut short (Mintlify's `llms.txt` cap or the sitemap location cap). */
  truncated: boolean
}

/** A page discovered from the site's index file. */
interface MintlifyPageLink {
  /** Site-absolute path without the `.md` extension, e.g. `/docs/quickstart`. */
  path: string
  title: string
  description?: string
  /** Nearest markdown heading above the link in `llms.txt`. */
  section?: string
}

interface MintlifySite {
  /** Scheme + host of the configured site, e.g. `https://docs.example.com`. */
  origin: string
  /** Configured base URL with any trailing slash removed, e.g. `https://docs.example.com/docs`. */
  baseUrl: string
  /** Hostname with a leading `www.` removed, used for same-site link filtering. */
  hostKey: string
  /** Path portion of `baseUrl` without a trailing slash, e.g. `/docs`, or `''` at the origin root. */
  basePath: string
}

/**
 * Normalizes the configured documentation site URL and runs an early structural
 * SSRF check via the shared `validateExternalUrl` policy.
 *
 * The authoritative SSRF boundary is enforced at request time: every site request
 * goes through {@link secureFetchWithRetry}, which resolves DNS, re-checks the
 * resolved IP, and pins the connection to it — closing the DNS-rebinding gap a
 * synchronous string check cannot.
 */
function resolveSite(rawUrl: string | undefined): MintlifySite {
  let url = (rawUrl || '').trim().replace(/\/+$/, '')
  if (!url) {
    throw new Error('Documentation site URL is required')
  }
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    url = `https://${url}`
  }

  const validation = validateExternalUrl(url, 'siteUrl', 'configuredEndpoint')
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid documentation site URL')
  }

  const parsed = new URL(url)
  return {
    origin: parsed.origin,
    baseUrl: url,
    hostKey: parsed.hostname.replace(/^www\./, ''),
    basePath: parsed.pathname.replace(/\/+$/, ''),
  }
}

/** Resolves the configured page cap, clamped to {@link MAX_PAGES_LIMIT}. */
function resolveMaxPages(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_PAGES
  return Math.min(Math.floor(parsed), MAX_PAGES_LIMIT)
}

/**
 * Normalizes an optional path prefix filter to a leading-slash, no-trailing-slash
 * form, or `''`.
 *
 * The trailing slash has to go: {@link isUnderPath} accepts an exact match or
 * `prefix + '/'`, so a raw `/guides/` would match neither `/guides` nor
 * `/guides/intro` and the source would silently sync nothing.
 */
function resolvePathPrefix(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  const prefix = trimmed.replace(/\/+$/, '')
  if (!prefix) return ''
  return prefix.startsWith('/') ? prefix : `/${prefix}`
}

/** Bearer headers, omitted when no key is configured (public sites need none). */
function siteHeaders(accessToken: string, accept: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept }
  if (accessToken?.trim()) {
    headers.Authorization = `Bearer ${accessToken.trim()}`
  }
  return headers
}

/**
 * Fetches a text resource from the user-supplied documentation host.
 *
 * `stripAuthOnRedirect` keeps the configured key from being forwarded to a
 * redirect target on another origin.
 */
async function fetchSiteText(
  url: string,
  accessToken: string,
  accept: string,
  maxBytes: number,
  retryOptions?: SecureFetchRetryOptions
): Promise<{ body: string; contentType: string } | null> {
  const response = await secureFetchWithRetry(
    url,
    {
      profile: 'configuredEndpoint',
      method: 'GET',
      headers: siteHeaders(accessToken, accept),
      stripAuthOnRedirect: true,
    },
    { ...retryOptions, maxResponseBytes: maxBytes }
  )

  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Mintlify site returned status ${response.status} for ${url}`)
  }

  return {
    body: await response.text(),
    contentType: response.headers.get('content-type') ?? '',
  }
}

/**
 * Converts a discovered link into a site-absolute path, or `null` when it points
 * off-site, is not an http(s) URL, or is not a documentation page. A leading
 * `www.` is ignored on both sides because Mintlify sites commonly redirect
 * between the apex and `www` host while emitting the canonical one in `llms.txt`.
 */
function toPagePath(rawHref: string, site: MintlifySite): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawHref, `${site.origin}/`)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (parsed.hostname.replace(/^www\./, '') !== site.hostKey) return null

  let path = parsed.pathname.replace(/\.md$/i, '').replace(/\/+$/, '')
  if (!path) path = '/'
  if (/\.(xml|json|ya?ml|txt|png|jpe?g|svg|gif|webp|pdf|zip|css|js)$/i.test(path)) return null
  return path
}

/** Derives a human-readable title from a page path, e.g. `/docs/api-keys` → `Api keys`. */
function titleFromPath(path: string): string {
  const slug = path.split('/').filter(Boolean).pop() || 'Index'
  const words = slug.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const LLMS_LINK_PATTERN = /^\s*[-*]?\s*\[([^\]]+)\]\(([^)\s]+)\)\s*(.*)$/
const MARKDOWN_HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/

/**
 * Strips the separator between a link and its description. `llms.txt` is a loose
 * convention, not a spec: Mintlify, Trigger.dev, and Resend emit
 * `](url.md): description` while Anthropic emits `](url.md) - description`, so
 * both a colon and a dash lead-in are removed.
 */
const LLMS_DESCRIPTION_SEPARATOR = /^[\s:\-–—]+/

/**
 * Parses the markdown link list Mintlify publishes at `/llms.txt`. Each entry is
 * a `- [Title](https://site/path.md): description` line, grouped under markdown
 * headings that name the navigation section.
 */
function parseLlmsTxt(body: string, site: MintlifySite): MintlifyPageLink[] {
  const pages: MintlifyPageLink[] = []
  const seen = new Set<string>()
  let section: string | undefined

  for (const line of body.split('\n')) {
    const heading = MARKDOWN_HEADING_PATTERN.exec(line)
    if (heading) {
      section = heading[2]
      continue
    }

    const match = LLMS_LINK_PATTERN.exec(line)
    if (!match) continue

    const path = toPagePath(match[2], site)
    if (!path || seen.has(path)) continue
    seen.add(path)

    const description = match[3]?.replace(LLMS_DESCRIPTION_SEPARATOR, '').trim()
    pages.push({
      path,
      title: match[1].trim() || titleFromPath(path),
      description: description || undefined,
      section,
    })
  }

  return pages
}

const SITEMAP_LOC_PATTERN = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
const SITEMAP_INDEX_PATTERN = /<sitemapindex[\s>]/i

/** Extracts every `<loc>` value from a sitemap document. */
function sitemapLocations(body: string): string[] {
  return [...body.matchAll(SITEMAP_LOC_PATTERN)].map((match) => match[1])
}

/** Parses `<loc>` page entries from a sitemap, used when the site has no `llms.txt`. */
function parseSitemap(locations: string[], site: MintlifySite): MintlifyPageLink[] {
  const pages: MintlifyPageLink[] = []
  const seen = new Set<string>()

  for (const location of locations) {
    const path = toPagePath(location, site)
    if (!path || seen.has(path)) continue
    seen.add(path)
    pages.push({ path, title: titleFromPath(path) })
  }

  return pages
}

/**
 * Resolves a same-site child-sitemap URL, or `null` when it points off-host.
 * `toPagePath` cannot be reused here because it rejects `.xml` by design.
 */
function sameSiteSitemapUrl(rawHref: string, site: MintlifySite): string | null {
  try {
    const parsed = new URL(rawHref, `${site.origin}/`)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (parsed.hostname.replace(/^www\./, '') !== site.hostKey) return null
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * Reads the site's sitemap, following a `<sitemapindex>` into its child sitemaps.
 * Without this a site that splits its sitemap would parse to zero pages — every
 * `<loc>` would be a `.xml` URL that {@link toPagePath} discards.
 */
async function discoverFromSitemap(
  site: MintlifySite,
  accessToken: string,
  retryOptions?: SecureFetchRetryOptions
): Promise<MintlifyDiscovery> {
  const root = await fetchSiteText(
    `${site.baseUrl}/sitemap.xml`,
    accessToken,
    'application/xml',
    INDEX_MAX_BYTES,
    retryOptions
  )
  if (!root) return { pages: [], truncated: false }

  if (!SITEMAP_INDEX_PATTERN.test(root.body)) {
    const rootLocations = sitemapLocations(root.body)
    return {
      pages: parseSitemap(rootLocations.slice(0, MAX_SITEMAP_LOCATIONS), site),
      truncated: rootLocations.length > MAX_SITEMAP_LOCATIONS,
    }
  }

  const allChildUrls = sitemapLocations(root.body)
    .map((location) => sameSiteSitemapUrl(location, site))
    .filter((url): url is string => Boolean(url))

  if (allChildUrls.length > MAX_CHILD_SITEMAPS) {
    throw new Error(
      `Sitemap index at ${site.baseUrl}/sitemap.xml lists ${allChildUrls.length} child sitemaps (limit ${MAX_CHILD_SITEMAPS})`
    )
  }

  logger.info('Following Mintlify sitemap index', { children: allChildUrls.length })

  const locations: string[] = []
  let truncated = false
  for (const childUrl of allChildUrls) {
    if (locations.length >= MAX_SITEMAP_LOCATIONS) {
      truncated = true
      logger.warn('Mintlify sitemap index exceeded the location cap', {
        cap: MAX_SITEMAP_LOCATIONS,
      })
      break
    }

    const child = await fetchSiteText(
      childUrl,
      accessToken,
      'application/xml',
      INDEX_MAX_BYTES,
      retryOptions
    )
    /**
     * A missing child sitemap is fatal rather than skipped. `fetchSiteText`
     * maps 404 to `null`, so continuing here would hand the sync engine a
     * listing short by one child's worth of pages — a partial listing the
     * engine cannot distinguish from genuine deletions, which reconciles every
     * page of that child out of the knowledge base.
     */
    if (!child) {
      throw new Error(`Child sitemap ${childUrl} listed in the sitemap index is unavailable`)
    }
    locations.push(...sitemapLocations(child.body))
  }

  if (locations.length > MAX_SITEMAP_LOCATIONS) {
    truncated = true
    locations.length = MAX_SITEMAP_LOCATIONS
  }

  return { pages: parseSitemap(locations, site), truncated }
}

/**
 * Restricts discovered pages to the configured base path.
 *
 * Applied to every discovery source, not just the origin-level index: a sub-path
 * site's `sitemap.xml` is equally free to enumerate the whole host, and a listing
 * that reaches outside the configured scope indexes pages the user did not ask
 * for. A no-op when the site is configured at the host root.
 */
function withinBasePath(pages: MintlifyPageLink[], site: MintlifySite): MintlifyPageLink[] {
  if (!site.basePath) return pages
  return pages.filter((page) => isUnderPath(page.path, site.basePath))
}

/**
 * Whether `path` is `prefix` itself or sits beneath it.
 *
 * A bare `startsWith` would also match a sibling whose name merely begins with
 * the prefix — `/guides` would capture `/guides-archive` — so the boundary `/`
 * is required.
 */
function isUnderPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * Discovers every page of the site.
 *
 * Mintlify's REST API has no page-enumeration endpoint — its discovery API only
 * supports query-driven search and path-addressed page reads — so the index files
 * Mintlify auto-publishes are the enumeration path. `/llms.txt` is preferred
 * because it carries titles, descriptions, and section grouping; `/sitemap.xml`
 * is the fallback for sites that disabled it.
 */
async function discoverPages(
  site: MintlifySite,
  accessToken: string,
  retryOptions?: SecureFetchRetryOptions
): Promise<MintlifyDiscovery> {
  /**
   * The origin-level index is only consulted for a site published at the host
   * root. On a sub-path site (`https://example.com/docs`) it describes the whole
   * host — the marketing site — and its handful of incidental `/docs` links is a
   * far worse listing than the sitemap's. Trusting it there produced a listing of
   * 13 pages for `trigger.dev/docs` against the 306 its own index publishes,
   * which the sync engine would reconcile as ~293 deletions.
   */
  const indexUrls = [
    ...new Set([
      `${site.baseUrl}/llms.txt`,
      `${site.baseUrl}/.well-known/llms.txt`,
      ...(site.basePath ? [] : [`${site.origin}/llms.txt`]),
    ]),
  ]

  for (const indexUrl of indexUrls) {
    const result = await fetchSiteText(
      indexUrl,
      accessToken,
      'text/plain',
      INDEX_MAX_BYTES,
      retryOptions
    )
    if (!result) continue
    const pages = withinBasePath(parseLlmsTxt(result.body, site), site)
    if (pages.length === 0) continue

    const truncated = result.body.length >= LLMS_TXT_MAX_CHARS - LLMS_TXT_TRUNCATION_MARGIN
    if (truncated) {
      logger.warn('Mintlify llms.txt is at its generated character cap; listing may be partial', {
        indexUrl,
        chars: result.body.length,
        cap: LLMS_TXT_MAX_CHARS,
      })
    }
    return { pages, truncated }
  }

  const sitemap = await discoverFromSitemap(site, accessToken, retryOptions)
  return { pages: withinBasePath(sitemap.pages, site), truncated: sitemap.truncated }
}

/** Elements whose *text content* is markup/data, never prose. */
const NON_CONTENT_ELEMENT_PATTERN =
  /<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi

/** `<main>` / `<article>` body, the prose region of a rendered docs page. */
const MAIN_REGION_PATTERN = /<(main|article)\b[^>]*>([\s\S]*)<\/\1>/i

const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g

/**
 * Extracts prose from a full HTML document.
 *
 * The shared {@link htmlToPlainText} only removes tags, so a script's *contents*
 * survive as text. Every other connector feeds it fragment HTML from an API
 * field, where that is fine; this connector is the only one that hands it a whole
 * server-rendered page. On a Next.js-rendered docs site that is catastrophic —
 * `docs.sim.ai/introduction` yields 310KB of "text" of which 294KB is the RSC
 * flight payload and site-wide navigation JSON, which both swamps the real page
 * content in retrieval and makes every page's extraction near-identical.
 *
 * So non-content elements are dropped whole, and the `<main>`/`<article>` region
 * is preferred over the full document to shed chrome (nav, sidebar, footer).
 */
function htmlPageToPlainText(html: string): string {
  const stripped = html.replace(HTML_COMMENT_PATTERN, ' ').replace(NON_CONTENT_ELEMENT_PATTERN, ' ')

  const main = MAIN_REGION_PATTERN.exec(stripped)
  const region = main ? main[2] : stripped
  const text = htmlToPlainText(region)

  /**
   * A site that renders its content entirely on the client leaves an empty
   * `<main>`; fall back to the whole document rather than reporting the page as
   * empty (which `getDocument` would turn into a dropped document).
   */
  return text || htmlToPlainText(stripped)
}

/**
 * Builds the listing stub for a page.
 *
 * A Mintlify page exposes no version, ETag, or trustworthy `Last-Modified`
 * (the hosted `.md` route reports the current time), so no metadata-derived
 * change indicator exists. The stub therefore carries a path-only hash that can
 * never equal a stored hash, which makes the sync engine re-hydrate every page;
 * `getDocument` then returns a content-derived hash and the engine skips the
 * write when it matches the stored one. Same trade-off as the Obsidian connector.
 */
function pageToStub(page: MintlifyPageLink, site: MintlifySite): ExternalDocument {
  return {
    externalId: page.path,
    title: page.title,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `${site.origin}${page.path}`,
    contentHash: `mintlify:${page.path}`,
    metadata: {
      path: page.path,
      section: page.section,
      description: page.description,
    },
  }
}

export const mintlifyConnector: ConnectorConfig = {
  ...mintlifyConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const site = resolveSite(sourceConfig.siteUrl as string)
    const pathPrefix = resolvePathPrefix(sourceConfig.pathPrefix)
    const maxPages = resolveMaxPages(sourceConfig.maxPages)

    let pages = syncContext?.pages as MintlifyPageLink[] | undefined
    if (!pages) {
      const { pages: discovered, truncated } = await discoverPages(site, accessToken)
      /**
       * An empty discovery means the site's index files were unreachable or
       * unparseable, not that the docs are empty — `validateConfig` refuses a
       * site with no index at setup time. Returning an empty listing would let
       * the sync engine reconcile every stored page away, so this fails the sync
       * instead: `shouldReconcileDeletions` never runs on a thrown sync.
       */
      if (discovered.length === 0) {
        throw new Error(
          `No pages found at ${site.baseUrl} — the site's llms.txt and sitemap.xml are unavailable`
        )
      }

      const filtered = pathPrefix
        ? discovered.filter((page) => isUnderPath(page.path, pathPrefix))
        : discovered

      /**
       * The listing is incomplete — either `maxPages` cut it while more pages
       * exist, or the source index itself was truncated (Mintlify's 100k-char
       * `llms.txt` cap, or the sitemap location cap). Deletion reconciliation
       * must be suppressed in both cases; otherwise every page missing from the
       * partial listing is hard-deleted from the knowledge base.
       */
      if ((truncated || filtered.length > maxPages) && syncContext) {
        syncContext.listingCapped = true
        logger.info('Mintlify page listing capped', {
          discovered: filtered.length,
          maxPages,
          indexTruncated: truncated,
        })
      }

      pages = filtered.slice(0, maxPages)
      if (syncContext) {
        syncContext.pages = pages
      }
    }

    const offset = cursor ? Number(cursor) : 0
    const pageSlice = pages.slice(offset, offset + DOCS_PER_PAGE)
    const nextOffset = offset + pageSlice.length
    const hasMore = nextOffset < pages.length

    return {
      documents: pageSlice.map((page) => pageToStub(page, site)),
      nextCursor: hasMore ? String(nextOffset) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const site = resolveSite(sourceConfig.siteUrl as string)
    const path = toPagePath(externalId, site)
    if (!path) {
      logger.warn('Skipping Mintlify page outside the configured site', { externalId })
      return null
    }

    const pages = syncContext?.pages as MintlifyPageLink[] | undefined
    const listed = pages?.find((page) => page.path === path)

    /**
     * Mintlify serves every page as raw Markdown at `{page}.md`. A site that
     * does not (a non-Mintlify host that merely publishes an `llms.txt`, or a
     * page removed from the Markdown route) answers 404 there, so the rendered
     * HTML page is the fallback and gets stripped to text. Both routes 404ing is
     * the only *documented* absence; every transport, status, or size failure
     * propagates out of `fetchSiteText` so the sync engine records a visible
     * failed document rather than reading the page as deleted.
     */
    const result =
      (await fetchSiteText(
        `${site.origin}${path === '/' ? '/index' : path}.md`,
        accessToken,
        'text/markdown',
        PAGE_MAX_BYTES
      )) ?? (await fetchSiteText(`${site.origin}${path}`, accessToken, 'text/html', PAGE_MAX_BYTES))
    if (!result) return null

    /**
     * The `.md` route serves Markdown, which is already plain text. An HTML
     * body — from the fallback above, or from a rewrite that ignores the
     * extension — is stripped so raw markup is never indexed.
     */
    const isHtml =
      result.contentType.includes('html') || /^\s*<(!doctype\s+html|html\b)/i.test(result.body)
    const content = isHtml ? htmlPageToPlainText(result.body) : result.body.trim()
    if (!content) return null

    const stub = pageToStub(listed ?? { path, title: titleFromPath(path) }, site)
    return {
      ...stub,
      content,
      contentDeferred: false,
      contentHash: `mintlify:${path}:${await computeContentHash(content)}`,
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    let site: MintlifySite
    try {
      site = resolveSite(sourceConfig.siteUrl as string)
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Invalid documentation site URL') }
    }

    const rawMaxPages = sourceConfig.maxPages
    if (rawMaxPages !== undefined && rawMaxPages !== null && rawMaxPages !== '') {
      const parsed = Number(rawMaxPages)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { valid: false, error: 'Max Pages must be a positive number' }
      }
    }

    try {
      const { pages } = await discoverPages(site, accessToken, VALIDATE_RETRY_OPTIONS)
      if (pages.length === 0) {
        return {
          valid: false,
          error: `No pages found at ${site.baseUrl}. The site must publish an llms.txt or sitemap.xml index.`,
        }
      }

      const pathPrefix = resolvePathPrefix(sourceConfig.pathPrefix)
      if (pathPrefix && !pages.some((page) => isUnderPath(page.path, pathPrefix))) {
        return { valid: false, error: `No pages match the path prefix "${pathPrefix}"` }
      }

      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        error: getErrorMessage(error, 'Failed to reach the Mintlify documentation site'),
      }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.section === 'string' && metadata.section.trim()) {
      result.section = metadata.section.trim()
    }

    if (typeof metadata.description === 'string' && metadata.description.trim()) {
      result.description = metadata.description.trim()
    }

    return result
  },
}
