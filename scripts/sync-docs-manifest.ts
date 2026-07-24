/**
 * Generate the static docs manifest the copilot's `docs/` VFS tree is built from.
 *
 * Source of truth: `apps/docs/content/docs/en/**\/*.mdx` — the English docs
 * corpus, whose folder structure mirrors the public docs.sim.ai URL structure.
 * The copilot never reads those files from disk (they are not deployed with
 * `apps/sim`); it globs this manifest for structure and fetches page content
 * from the live site on demand. That makes the manifest the one thing that can
 * drift, hence `--check` in CI.
 *
 * Path derivation (each entry is BOTH the `docs/`-relative VFS path and the
 * docs.sim.ai URL path, so a read is a plain fetch of `https://docs.sim.ai/<entry>`):
 *   - `workflows/blocks/agent.mdx` → `workflows/blocks/agent.mdx`
 *   - `workflows/index.mdx`        → `workflows.mdx`   (fumadocs folds index pages
 *                                     into their parent URL; `/workflows/index.mdx`
 *                                     is a 404 on the site)
 *
 * Excluded, and intentionally absent from the VFS: `academy/` and
 * `api-reference/` (fetch those with the scrape tool if ever needed), the root
 * `index.mdx` (its URL is `/`, which redirects), and every non-`en` locale.
 *
 * Usage:
 *   bun run docs-manifest:generate   # write the manifest
 *   bun run docs-manifest:check      # fail (exit 1) if the manifest is stale
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatGeneratedSource } from './format-generated-source'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DOCS_CONTENT_DIR = resolve(ROOT, 'apps/docs/content/docs/en')
const OUTPUT_PATH = resolve(ROOT, 'apps/sim/lib/copilot/generated/docs-manifest.ts')

/** Top-level docs sections deliberately left out of the copilot's `docs/` tree. */
const EXCLUDED_SECTIONS = new Set(['academy', 'api-reference'])

/** Collect every `.mdx` file under `dir`, as paths relative to {@link DOCS_CONTENT_DIR}. */
async function collectMdxPaths(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (prefix === '' && EXCLUDED_SECTIONS.has(entry.name)) continue
      paths.push(...(await collectMdxPaths(resolve(dir, entry.name), relative)))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.mdx')) paths.push(relative)
  }
  return paths
}

/** Map an `en`-relative mdx file path to its docs.sim.ai URL path, or null to drop it. */
function toDocsPath(mdxPath: string): string | null {
  if (mdxPath === 'index.mdx') return null
  return mdxPath.replace(/\/index\.mdx$/, '.mdx')
}

function render(paths: string[]): string {
  const entries = paths.map((path) => `  '${path}',`).join('\n')
  return `// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated from apps/docs/content/docs/en by scripts/sync-docs-manifest.ts
// Run: bun run docs-manifest:generate
//

/**
 * Every page in the copilot's read-only \`docs/\` VFS tree, as a path that is
 * simultaneously the \`docs/\`-relative VFS path and the docs.sim.ai URL path
 * (so \`docs/workflows/blocks/agent.mdx\` reads
 * \`https://docs.sim.ai/workflows/blocks/agent.mdx\`). Sorted.
 */
export const DOCS_MANIFEST: readonly string[] = [
${entries}
]
`
}

async function main() {
  const checkOnly = process.argv.includes('--check')

  const mdxPaths = await collectMdxPaths(DOCS_CONTENT_DIR)
  const docsPaths = mdxPaths
    .map(toDocsPath)
    .filter((path): path is string => path !== null)
    .sort()

  if (docsPaths.length === 0) {
    throw new Error(`No docs pages found under ${DOCS_CONTENT_DIR}`)
  }

  const rendered = formatGeneratedSource(render(docsPaths), OUTPUT_PATH, ROOT)

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered) {
      throw new Error(
        'Generated docs manifest is stale — the docs tree changed (page added, removed, or renamed). Run: bun run docs-manifest:generate'
      )
    }
    return
  }

  await writeFile(OUTPUT_PATH, rendered, 'utf8')
}

await main()
