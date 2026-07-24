import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { foldDocsIndexPath } from '@/lib/copilot/docs/docs-path'
import { DOCS_MANIFEST } from '@/lib/copilot/generated/docs-manifest'
import type { GrepCountEntry, GrepMatch, GrepOptions } from '@/lib/copilot/vfs/operations'
import { glob as globPaths, grepReadResult } from '@/lib/copilot/vfs/operations'

const logger = createLogger('DocsCorpus')

/** The public docs site the `docs/` tree is a lazy view of. */
const DOCS_BASE_URL = 'https://docs.sim.ai'

/** VFS prefix the docs corpus is mounted at. */
const DOCS_PREFIX = 'docs/'

const FETCH_TIMEOUT_MS = 10_000

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
  return path.trim().replace(/^\/+/, '')
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
 * to its raw-markdown route), so no mapping table is needed. Returns null when
 * the page is not in the manifest or the site does not serve it.
 */
type DocsFetchResult =
  | { outcome: 'ok'; content: string }
  /** The site will not serve this path however many times we ask. */
  | { outcome: 'missing' }
  /** Transient: 5xx, 429, network error, or timeout. */
  | { outcome: 'unavailable' }

async function fetchDocsPage(path: string): Promise<DocsFetchResult> {
  const key = normalize(path)
  if (!docsKeyView.has(key)) return { outcome: 'missing' }
  const url = `${DOCS_BASE_URL}/${key.slice(DOCS_PREFIX.length)}`
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
      `Could not load ${key} from ${DOCS_BASE_URL} — the docs site is temporarily unavailable. Retry shortly.`
    )
  }
  return { content: result.content, totalLines: result.content.split('\n').length }
}

/**
 * Grep ONE docs page, mirroring how grep over `files/` works: each page is a
 * separate fetch from the docs site, so a multi-page grep would mean hundreds of
 * requests. A path that is not a single page throws.
 */
export async function grepDocsPage(
  path: string,
  pattern: string,
  options?: GrepOptions
): Promise<GrepMatch[] | string[] | GrepCountEntry[]> {
  const key = normalize(path)
  if (!docsKeyView.has(key)) {
    throw new DocsCorpusError(
      `Grep over the docs corpus must target a single page (e.g. path: "docs/workflows/blocks/agent.mdx"). "${path}" is not a docs page. Use glob("docs/**") to find the exact path, then grep that one page.`
    )
  }
  const page = await readDocsPage(key)
  return grepReadResult(key, page, pattern, key, options)
}
