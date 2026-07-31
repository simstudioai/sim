/**
 * Reports the size of the client JavaScript a production build ships, so a
 * bundle regression is something CI can see rather than something a user
 * reports as a slow page.
 *
 * Nothing else measures this today. Turbopack's route table prints only
 * `Revalidate`/`Expire` — no `First Load JS` — and it emits flat,
 * content-hashed chunk names with no `app-build-manifest.json`, so there is no
 * route -> chunk mapping to attribute bytes with. `@next/bundle-analyzer` is a
 * webpack plugin and is not installed. This measures what is reliably
 * available: the total client payload, plus the largest chunks so a jump can be
 * traced to a culprit.
 *
 * Deliberately not per-route. A per-route number would need either a
 * route->chunk manifest Turbopack does not emit, or a browser loading each
 * route; inventing an attribution from flat chunk names would produce a
 * confident number that is wrong.
 *
 * Usage:
 *   bun run scripts/measure-client-bundle.ts                       # human-readable
 *   bun run scripts/measure-client-bundle.ts --json                # machine-readable
 *   bun run scripts/measure-client-bundle.ts --baseline b.json     # compare, fail on regression
 *   bun run scripts/measure-client-bundle.ts --json > baseline.json
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const rootDir = path.resolve(path.dirname(__filename), '..')
const chunkDir = path.join(rootDir, 'apps/sim/.next/static/chunks')

/** Fraction a total may grow past the baseline before `--baseline` fails. */
const REGRESSION_TOLERANCE = 0.02

interface Chunk {
  file: string
  bytes: number
}

interface Report {
  totalBytes: number
  chunkCount: number
  largest: Chunk[]
}

function walk(dir: string, acc: Chunk[] = []): Chunk[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, acc)
      continue
    }
    // `.map` files are excluded: they are never requested during page load, so
    // counting them would let a source-map change masquerade as a bundle
    // regression.
    if (entry.isFile() && entry.name.endsWith('.js')) {
      acc.push({ file: path.relative(chunkDir, full), bytes: fs.statSync(full).size })
    }
  }
  return acc
}

function measure(): Report {
  if (!fs.existsSync(chunkDir)) {
    throw new Error(
      `No build found at ${path.relative(rootDir, chunkDir)}. Run \`bun run build\` in apps/sim first.`
    )
  }
  const chunks = walk(chunkDir)
  if (chunks.length === 0) {
    throw new Error(`No .js chunks under ${path.relative(rootDir, chunkDir)} — build looks empty.`)
  }
  return {
    totalBytes: chunks.reduce((sum, c) => sum + c.bytes, 0),
    chunkCount: chunks.length,
    largest: [...chunks].sort((a, b) => b.bytes - a.bytes).slice(0, 15),
  }
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

function main(): void {
  const args = process.argv.slice(2)
  const report = measure()

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }

  console.log(`Client JS: ${mb(report.totalBytes)} across ${report.chunkCount} chunks\n`)
  console.log('Largest chunks:')
  for (const c of report.largest) {
    console.log(`  ${mb(c.bytes).padStart(9)}  ${c.file}`)
  }

  const baselineIdx = args.indexOf('--baseline')
  if (baselineIdx === -1) return

  const baselinePath = args[baselineIdx + 1]
  if (!baselinePath) {
    console.error('\n--baseline requires a path to a JSON report')
    process.exit(1)
  }
  const baseline: Report = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  const delta = report.totalBytes - baseline.totalBytes
  const pct = (delta / baseline.totalBytes) * 100
  const sign = delta >= 0 ? '+' : ''
  console.log(
    `\nvs baseline: ${mb(baseline.totalBytes)} -> ${mb(report.totalBytes)} (${sign}${pct.toFixed(1)}%)`
  )

  if (delta > baseline.totalBytes * REGRESSION_TOLERANCE) {
    console.error(
      `\nClient JS grew more than ${(REGRESSION_TOLERANCE * 100).toFixed(0)}% over the baseline.`
    )
    process.exit(1)
  }
}

main()
