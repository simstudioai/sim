import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { foldDocsIndexPath } from '@/lib/copilot/docs/docs-path'
import { DOCS_MANIFEST } from '@/lib/copilot/generated/docs-manifest'
import type { GrepCountEntry, GrepMatch, GrepOptions } from '@/lib/copilot/vfs/operations'
import { glob as globPaths, grepReadResult } from '@/lib/copilot/vfs/operations'

const logger = createLogger('DocsCorpus')

/** The public docs site the `docs/` tree is a lazy view of. */
const DOCS_BASE_URL = 'https://docs.sim.ai'

/** VFS prefix the docs corpus is mounted at. */
const DOCS_PREFIX = 'docs/'

/** Per-attempt budget — the site is CDN-cached and normally answers in well under a second. */
const FETCH_ATTEMPT_TIMEOUT_MS = 3_000
const FETCH_MAX_ATTEMPTS = 3

/**
 * Thrown for expected, user-facing docs-corpus conditions (unknown page,
 * directory path, site unreachable). The VFS handlers return the message as the
 * tool error instead of logging an internal failure.
 */
export class DocsCorpusError extends Error {
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

/**
 * Normalize a docs path and make `docs/` equivalent to `docs`, avoiding empty
 * glob results caused only by a trailing slash.
 */
export function normalizeDocsPath(path: string): string {
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
  const normalized = normalizeDocsPath(path)
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
  return globPaths(docsKeyView, normalizeDocsPath(pattern))
}

/** True when `path` is a page in the docs tree. */
export function isDocsPage(path: string): boolean {
  return docsKeyView.has(normalizeDocsPath(path))
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
  const dir = `${normalizeDocsPath(path).replace(/\/+$/, '')}/`
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
  | { outcome: 'unavailable'; retryAfterMs: number | null }

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw toError(signal.reason ?? 'Docs request aborted')
  }
}

async function sleepForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await sleep(delayMs)
    return
  }

  throwIfAborted(signal)
  let abortListener: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(toError(signal.reason ?? 'Docs request aborted'))
    signal.addEventListener('abort', abortListener, { once: true })
    if (signal.aborted) abortListener()
  })

  try {
    await Promise.race([sleep(delayMs), aborted])
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener)
  }
}

async function fetchDocsPageOnce(url: string, signal?: AbortSignal): Promise<DocsFetchResult> {
  throwIfAborted(signal)
  const timeoutSignal = AbortSignal.timeout(FETCH_ATTEMPT_TIMEOUT_MS)
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  try {
    const response = await fetch(url, {
      signal: requestSignal,
      headers: { Accept: 'text/markdown, text/plain' },
    })
    if (!response.ok) {
      logger.warn('Docs page fetch returned a non-OK status', { url, status: response.status })
      const permanent =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      if (permanent) return { outcome: 'missing' }
      return {
        outcome: 'unavailable',
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      }
    }
    return { outcome: 'ok', content: await response.text() }
  } catch (err) {
    throwIfAborted(signal)
    logger.warn('Docs page fetch failed', { url, error: toError(err).message })
    return { outcome: 'unavailable', retryAfterMs: null }
  }
}

async function fetchDocsPage(path: string, signal?: AbortSignal): Promise<DocsFetchResult> {
  const key = normalizeDocsPath(path)
  if (!docsKeyView.has(key)) return { outcome: 'missing' }
  const url = `${DOCS_BASE_URL}/${key.slice(DOCS_PREFIX.length)}`
  for (let attempt = 1; ; attempt++) {
    throwIfAborted(signal)
    const result = await fetchDocsPageOnce(url, signal)
    throwIfAborted(signal)
    if (result.outcome !== 'unavailable' || attempt >= FETCH_MAX_ATTEMPTS) return result
    await sleepForRetry(backoffWithJitter(attempt, result.retryAfterMs), signal)
  }
}

/**
 * Read one docs page. Throws {@link DocsCorpusError} for the expected user-facing
 * conditions (directory path, unknown page, site unreachable) so the handler can
 * surface the message verbatim.
 */
export async function readDocsPage(path: string, signal?: AbortSignal): Promise<DocsPage> {
  const key = normalizeDocsPath(path)
  if (!docsKeyView.has(key)) {
    if (isDocsDir(key)) {
      const dir = key.replace(/\/+$/, '')
      throw new DocsCorpusError(`${dir} is a directory — glob "${dir}/**" to list its pages.`)
    }
    throw new DocsCorpusError(
      `Docs page not found: ${path}. Use glob("docs/**") to list the docs corpus.`
    )
  }
  const result = await fetchDocsPage(key, signal)
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
 * Grep one docs page. Directory-wide grep is deliberately unsupported because
 * each page is a separate network fetch; use `search_docs` for corpus search or
 * `glob("docs/**")` to find a page first.
 */
export async function grepDocs(
  path: string,
  pattern: string,
  options?: GrepOptions,
  signal?: AbortSignal
): Promise<GrepMatch[] | string[] | GrepCountEntry[]> {
  const key = normalizeDocsPath(path)
  if (!docsKeyView.has(key)) {
    if (isDocsDir(key)) {
      throw new DocsCorpusError(
        `"${path}" is a docs directory; grep must target one docs page. Use search_docs to search the corpus or glob("${key}/**") to list its pages.`
      )
    }
    throw new DocsCorpusError(
      `"${path}" is not a docs page. Use glob("docs/**") to list the docs corpus.`
    )
  }
  const page = await readDocsPage(key, signal)
  return grepReadResult(key, page, pattern, key, options)
}
