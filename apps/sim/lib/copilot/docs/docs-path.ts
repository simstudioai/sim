/**
 * The single definition of how a docs source file maps onto its public path.
 *
 * Fumadocs folds a section's `index.mdx` into the section URL itself, so
 * `workflows/index.mdx` on disk is `/workflows` on the site (and
 * `/workflows/index.mdx` is a 404). Three places need that rule — the manifest
 * generator, the `source_document` -> VFS reverse mapping, and the vector
 * search's scope filter — and hand-syncing it has bitten this repo before, so
 * it lives here.
 *
 * Deliberately dependency-free: `scripts/sync-docs-manifest.ts` imports this by
 * relative path, and it must not pull in the manifest it generates.
 */

/** Suffix that marks a section overview page on disk. */
export const DOCS_INDEX_SUFFIX = '/index.mdx'

/**
 * Top-level docs sections deliberately left out of the copilot's `docs/` tree.
 *
 * Two places must agree on this list or the corpus goes subtly wrong: the
 * manifest generator (which decides what is readable) and the vector search's
 * unscoped filter (which decides what is findable). If search still matched an
 * unmounted section, every hit there would be a chunk the agent cannot then
 * `read` — dropped as stale, silently shrinking the result set.
 *
 * Mounting a section later is not uniform work, so plan per section:
 * - `academy` is plain mdx under `apps/docs/content/docs/en/academy` and is
 *   already indexed in `docs_embeddings` — removing it here and regenerating
 *   the manifest is the whole change.
 * - `api-reference` is mostly generated from `apps/docs/openapi.json` at build
 *   time, so its pages have no source mdx for the generator to walk (only the
 *   four handwritten ones: authentication, getting-started, python, typescript).
 *   Mounting it properly needs the spec served publicly again — the
 *   `apps/docs/app/openapi.json` route existed for exactly this and was
 *   reverted — plus a generator branch that walks the spec's tags.
 */
export const UNMOUNTED_DOCS_SECTIONS = ['academy', 'api-reference'] as const

/**
 * Fold an `en`-relative mdx file path onto its public path — the value used as
 * both the `docs/`-relative VFS path and the docs.sim.ai URL path.
 */
export function foldDocsIndexPath(mdxPath: string): string {
  return mdxPath.endsWith(DOCS_INDEX_SUFFIX)
    ? `${mdxPath.slice(0, -DOCS_INDEX_SUFFIX.length)}.mdx`
    : mdxPath
}

/**
 * The inverse of {@link foldDocsIndexPath}: the on-disk file names a public
 * path could have come from. A page is stored either as `<stem>.mdx` or, when
 * it is a section overview, as `<stem>/index.mdx`.
 */
export function docsSourceCandidates(publicPath: string): [string, string] {
  const stem = publicPath.replace(/\.mdx$/, '')
  return [`${stem}.mdx`, `${stem}${DOCS_INDEX_SUFFIX}`]
}
