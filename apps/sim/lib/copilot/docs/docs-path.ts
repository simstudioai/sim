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
