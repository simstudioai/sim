import { trace } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { foldDocsIndexPath } from '@/lib/copilot/docs/docs-path'
import { DOCS_MANIFEST } from '@/lib/copilot/generated/docs-manifest'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import type { GrepCountEntry, GrepMatch, GrepOptions } from '@/lib/copilot/vfs/operations'
import { glob as globPaths, grep, grepReadResult } from '@/lib/copilot/vfs/operations'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'

const logger = createLogger('DocsCorpus')

/** The public docs site the `docs/` tree is a lazy view of. */
const DOCS_BASE_URL = 'https://docs.sim.ai'

/** VFS prefix the docs corpus is mounted at. */
const DOCS_PREFIX = 'docs/'

/** Per-attempt budget — the site is CDN-cached and normally answers in well under a second. */
const FETCH_ATTEMPT_TIMEOUT_MS = 3_000
const FETCH_MAX_ATTEMPTS = 3

/** Parallel page fetches for a directory-scoped grep. */
const GREP_FETCH_CONCURRENCY = 8

/**
 * Thrown for expected, user-facing docs-corpus conditions (unknown page,
 * directory path, site unreachable). The VFS handlers return the message as the
 * tool error instead of logging an internal failure.
 */
export class DocsCorpusError extends Error {
  readonly code = 'DOCS_CORPUS' as const
  constructor(message: string) {
    super(message)
    this.name = 'DocsCorpusError'
  }
}

/**
 * Keys-only view of the corpus for glob: every manifest path under `docs/`,
 * mapped to empty content. `ops.glob` matches keys and derives the virtual
 * directories from them, so this never touches the network.
 */
const docsKeyView: Map<string, string> = new Map(
  DOCS_MANIFEST.map((path) => [`${DOCS_PREFIX}${path}`, ''])
)

function normalize(path: string): string {
  // Trailing slashes are stripped so `docs/` addresses the corpus the same way
  // `docs` does — otherwise a trailing-slash glob pattern matches no key and
  // silently returns an empty result instead of the corpus listing.
  return path.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * True when a read/grep `path` addresses the docs corpus. Deliberately not a
 * `path is string` type predicate: the callers chain it ahead of the other
 * namespace checks, and a predicate would narrow `path` to `never` in every
 * later branch.
 */
export function isDocsPath(path: string | undefined): boolean {
  if (!path) return false
  const normalized = normalize(path)
  return normalized === 'docs' || normalized.startsWith(DOCS_PREFIX)
}

/**
 * True when a glob `pattern` could match the docs corpus. Like `uploads/` and
 * `recently-deleted/`, the corpus is opt-in: only a pattern that explicitly
 * starts with `docs/` (or is exactly `docs`) sees it, so a broad `**` glob never
 * drags 300+ doc pages into the result. Same rule as {@link isDocsPath}; the
 * separate name reads correctly at the glob call site.
 */
export function couldMatchDocsScope(pattern: string | undefined): boolean {
  return isDocsPath(pattern)
}

/** Manifest paths (and their virtual directories) matching an explicit `docs/` pattern. */
export function globDocs(pattern: string): string[] {
  return globPaths(docsKeyView, normalize(pattern))
}

/** True when `path` is a page in the docs tree. */
export function isDocsPage(path: string): boolean {
  return docsKeyView.has(normalize(path))
}

/**
 * Map a `docs_embeddings.source_document` (the en-relative mdx file path) back to
 * its `docs/` VFS path, applying the same index-page fold as the manifest
 * generator. Returns null when the source has no live VFS path — an unmounted
 * section (academy, api-reference) or a page deleted since the index was built.
 */
export function docsPathForSourceDocument(sourceDocument: string | null): string | null {
  if (!sourceDocument) return null
  const path = `${DOCS_PREFIX}${foldDocsIndexPath(sourceDocument.replace(/^\/+/, ''))}`
  return docsKeyView.has(path) ? path : null
}

/** True when `path` is a directory in the docs tree rather than a page. */
export function isDocsDir(path: string): boolean {
  const dir = `${normalize(path).replace(/\/+$/, '')}/`
  if (dir === DOCS_PREFIX) return true
  for (const key of docsKeyView.keys()) {
    if (key.startsWith(dir)) return true
  }
  return false
}

export interface DocsPage {
  content: string
  totalLines: number
}

/**
 * Fetch one docs page's raw markdown from the live site. The manifest path IS
 * the URL path (`docs/workflows/blocks/agent.mdx` →
 * `https://docs.sim.ai/workflows/blocks/agent.mdx`, which the docs app rewrites
 * to its raw-markdown route), so no mapping table is needed. Transient failures
 * (5xx, 429, network error, timeout) are retried with jittered backoff before
 * being reported as unavailable.
 */
type DocsFetchResult =
  | { outcome: 'ok'; content: string }
  /** The site will not serve this path however many times we ask. */
  | { outcome: 'missing' }
  /** Transient: 5xx, 429, network error, or timeout. */
  | { outcome: 'unavailable' }

async function fetchDocsPageOnce(url: string): Promise<DocsFetchResult> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_ATTEMPT_TIMEOUT_MS),
      headers: { Accept: 'text/markdown, text/plain' },
    })
    if (!response.ok) {
      logger.warn('Docs page fetch returned a non-OK status', { url, status: response.status })
      const permanent = response.status >= 400 && response.status < 500 && response.status !== 429
      return { outcome: permanent ? 'missing' : 'unavailable' }
    }
    return { outcome: 'ok', content: await response.text() }
  } catch (err) {
    logger.warn('Docs page fetch failed', { url, error: toError(err).message })
    return { outcome: 'unavailable' }
  }
}

async function fetchDocsPage(path: string): Promise<DocsFetchResult> {
  const key = normalize(path)
  if (!docsKeyView.has(key)) return { outcome: 'missing' }
  const url = `${DOCS_BASE_URL}/${key.slice(DOCS_PREFIX.length)}`
  for (let attempt = 1; ; attempt++) {
    const result = await fetchDocsPageOnce(url)
    if (result.outcome !== 'unavailable' || attempt >= FETCH_MAX_ATTEMPTS) return result
    await sleep(backoffWithJitter(attempt, null))
  }
}

/**
 * Read one docs page. Throws {@link DocsCorpusError} for the expected user-facing
 * conditions (directory path, unknown page, site unreachable) so the handler can
 * surface the message verbatim.
 */
export async function readDocsPage(path: string): Promise<DocsPage> {
  const key = normalize(path)
  if (!docsKeyView.has(key)) {
    if (isDocsDir(key)) {
      const dir = key.replace(/\/+$/, '')
      throw new DocsCorpusError(`${dir} is a directory — glob "${dir}/**" to list its pages.`)
    }
    throw new DocsCorpusError(
      `Docs page not found: ${path}. Use glob("docs/**") to list the docs corpus.`
    )
  }
  const result = await fetchDocsPage(key)
  if (result.outcome === 'missing') {
    throw new DocsCorpusError(
      `${key} is in the docs index but ${DOCS_BASE_URL} does not serve it — the page was likely moved or removed. Use glob("docs/**") to find the current path; retrying will not help.`
    )
  }
  if (result.outcome === 'unavailable') {
    throw new DocsCorpusError(
      `Could not load ${key} from ${DOCS_BASE_URL} — the docs site could not be reached. Retry shortly.`
    )
  }
  return { content: result.content, totalLines: result.content.split('\n').length }
}

/**
 * Grep the docs corpus. A single page greps just that page. A directory path
 * (`docs`, `docs/files`) fans out to every manifest page under it: pages are
 * fetched in parallel and searched as one multi-file grep, so results follow
 * manifest order and `maxResults` applies across pages. Pages the site no
 * longer serves are skipped; a page that cannot be reached after retries fails
 * the whole grep, because a silent partial result would misread as "not
 * documented".
 */
export async function grepDocs(
  path: string,
  pattern: string,
  options?: GrepOptions
): Promise<GrepMatch[] | string[] | GrepCountEntry[]> {
  const key = normalize(path)
  if (docsKeyView.has(key)) {
    const page = await readDocsPage(key)
    return grepReadResult(key, page, pattern, key, options)
  }
  if (!isDocsDir(key)) {
    throw new DocsCorpusError(
      `"${path}" is not a docs page or directory. Use glob("docs/**") to list the docs corpus.`
    )
  }
  const dir = `${key}/`
  const pages = [...docsKeyView.keys()].filter((pageKey) => pageKey.startsWith(dir))
  trace.getActiveSpan()?.setAttribute(TraceAttr.CopilotVfsGrepDocsPageCount, pages.length)
  let unreachable = 0
  const results = await mapWithConcurrency(pages, GREP_FETCH_CONCURRENCY, async (pageKey) => {
    // Once any page is unreachable the grep is going to fail — skip the
    // remaining fetches instead of hammering a site that is not answering.
    if (unreachable > 0) return null
    const result = await fetchDocsPage(pageKey)
    if (result.outcome === 'unavailable') unreachable++
    return result
  })
  if (unreachable > 0) {
    throw new DocsCorpusError(
      `Could not load every page under ${dir} from ${DOCS_BASE_URL} — a partial grep could misread as "not documented". Retry shortly.`
    )
  }
  const contents = new Map<string, string>()
  results.forEach((result, index) => {
    if (result?.outcome === 'ok') contents.set(pages[index], result.content)
  })
  return grep(contents, pattern, undefined, options)
}
