import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { defineConfig, defineDocs, frontmatterSchema } from 'fumadocs-mdx/config'
import lastModified from 'fumadocs-mdx/plugins/last-modified'
import { curlJsonBodyGrammar } from './lib/shiki-curl-json'
import { simShikiOptions } from './lib/shiki-theme'

const DOCS_DIR = 'content/docs'

export const docs = defineDocs({
  dir: DOCS_DIR,
  docs: {
    schema: frontmatterSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
})

/**
 * Last-commit author date of every file under {@link DOCS_DIR}, keyed by absolute path, from one
 * `git log` pass instead of the plugin's per-file `git log -1` spawn (~500 files). `undefined`
 * when git is missing or the clone is shallow: a shallow clone attributes every file untouched
 * since its boundary commit to that commit, so pages carry no `lastModified` rather than a
 * fabricated one.
 */
function readGitLastModified(): Map<string, Date> | undefined {
  const git = (args: string[]) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  try {
    if (git(['rev-parse', '--is-shallow-repository']) !== 'false') return undefined
    const root = git(['rev-parse', '--show-toplevel'])
    const dates = new Map<string, Date>()
    const log = git([
      '-c',
      'core.quotepath=off',
      'log',
      '--format=%x00%aI',
      '--name-only',
      '--',
      DOCS_DIR,
    ])
    let date: Date | undefined
    for (const line of log.split('\n')) {
      if (line.startsWith('\0')) date = new Date(line.slice(1))
      else if (line && date) {
        const file = path.join(root, line)
        if (!dates.has(file)) dates.set(file, date)
      }
    }
    return dates
  } catch {
    return undefined
  }
}

const gitLastModified = readGitLastModified()

export default defineConfig({
  /** Always registered so the generated page types are the same with or without git history. */
  plugins: [
    lastModified({ versionControl: async (file) => gitLastModified?.get(path.resolve(file)) }),
  ],
  mdxOptions: {
    /**
     * Shiki defaults to `github-light` / `github-dark`, whose blues and purples appear nowhere
     * in the product. These themes carry the platform's own token colors instead — see
     * `lib/shiki-theme.ts`.
     */
    rehypeCodeOptions: {
      ...simShikiOptions,
      /** Preloads the injection that colors a `curl -d '{…}'` body — see lib/shiki-curl-json.ts. */
      langs: [curlJsonBodyGrammar],
    },
  },
})
