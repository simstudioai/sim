/**
 * The v2 route table: every `apps/sim/app/api/v2/** /route.ts`, keyed by the URL
 * pattern its directory spells, for the in-process transport
 * (`lib/api/server/routes/in-process-transport.ts`) to dispatch the server's own
 * requests without a network hop.
 *
 *   bun run generate:v2-route-table   # rewrite the table
 *   bun run check:v2-route-table      # fail when the checked-in table is stale (check:audits)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = path.join(ROOT, 'apps/sim/app')
const API_DIR = path.join(APP_DIR, 'api/v2')
const OUTPUT = path.join(ROOT, 'apps/sim/lib/api/server/routes/v2-route-table.generated.ts')

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) routeFiles(full, out)
    else if (entry.name === 'route.ts') out.push(full)
  }
  return out
}

function render(): string {
  const entries = routeFiles(API_DIR)
    .map((file) => {
      const dir = path.relative(APP_DIR, path.dirname(file)).split(path.sep)
      const pattern = `/${dir.map((segment) => segment.replace(/^\[(.+)\]$/, '{$1}')).join('/')}`
      return { pattern, specifier: `@/app/${dir.join('/')}/route` }
    })
    .sort((a, b) => a.pattern.localeCompare(b.pattern))
  const lines = entries.map(
    ({ pattern, specifier }) =>
      `  {\n    pattern: '${pattern}',\n    load: () => import('${specifier}'),\n  },`
  )
  return `/**
 * GENERATED — do not edit. Source of truth: the route files under apps/sim/app/api/v2.
 * Regenerate with \`bun run generate:v2-route-table\`; \`check:v2-route-table\` fails on drift.
 */

export interface V2RouteEntry {
  /** The URL pattern, with \`{name}\` for each dynamic segment. */
  pattern: string
  load: () => Promise<object>
}

export const V2_ROUTES: readonly V2RouteEntry[] = [
${lines.join('\n')}
]
`
}

/**
 * The table goes through biome's own formatter before it is written or compared, so
 * lint-staged and `biome check` on the checked-in file never disagree with `--check`.
 */
function formatted(source: string): string {
  const result = Bun.spawnSync(['bunx', 'biome', 'format', '--stdin-file-path', OUTPUT], {
    stdin: Buffer.from(source),
    cwd: ROOT,
  })
  if (result.exitCode !== 0) {
    throw new Error(`biome format failed: ${result.stderr.toString()}`)
  }
  return result.stdout.toString()
}

const content = formatted(render())
const routeCount = content.split('pattern:').length - 1
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : ''
  if (current !== content) {
    console.error(
      `v2 route table is stale: ${path.relative(ROOT, OUTPUT)} does not match apps/sim/app/api/v2. Run: bun run generate:v2-route-table`
    )
    process.exit(1)
  }
  console.log(`v2 route table is up to date (${routeCount} routes).`)
} else {
  fs.writeFileSync(OUTPUT, content)
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${routeCount} routes).`)
}
