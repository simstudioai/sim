import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatGeneratedSource } from './format-generated-source'

/**
 * Generate `apps/sim/lib/copilot/generated/metrics-v1.ts` from the Go-side
 * `contracts/metrics-v1.schema.json` contract.
 *
 * The contract is a single-enum JSON Schema listing every canonical mothership
 * OTel METRIC name. Go and Sim BOTH emit mothership metrics (the agent loop in
 * Go; server-side tool/VFS/file instrumentation in Sim), so both sides MUST
 * emit identical metric names for `histogram_quantile(sum by (le) …)` over the
 * Go∪Sim union to be valid. We emit:
 *   - A `Metric` const object keyed by PascalCase identifier whose values are
 *     the exact wire names, so call sites read `meter.createHistogram(
 *     Metric.CopilotToolDuration)` instead of a raw string literal.
 *   - A `MetricKey` / `MetricValue` union pair.
 *   - A sorted `MetricValues` readonly array for tests/enumeration.
 *
 * Label allowlists and histogram bucket boundaries are NOT encoded in the
 * schema (name-only). The Go side owns the label-cardinality allowlist
 * (contracts/metrics_v1.go) and the shared bucket constant
 * (internal/telemetry/metrics.go); the Sim emitter MUST use the identical
 * label keys and bucket boundaries by hand.
 *
 * This is the metric-name twin of `sync-trace-attributes-contract.ts`; the two
 * share the enum-extraction + PascalCase + collision-detection pattern.
 */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CONTRACT_PATH = resolve(ROOT, '../copilot/copilot/contracts/metrics-v1.schema.json')
const OUTPUT_PATH = resolve(ROOT, 'apps/sim/lib/copilot/generated/metrics-v1.ts')

function extractMetricNames(schema: Record<string, unknown>): string[] {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>
  const nameDef = defs.MetricsV1Name
  if (
    !nameDef ||
    typeof nameDef !== 'object' ||
    !Array.isArray((nameDef as Record<string, unknown>).enum)
  ) {
    throw new Error('metrics-v1.schema.json is missing $defs.MetricsV1Name.enum')
  }
  const enumValues = (nameDef as Record<string, unknown>).enum as unknown[]
  if (!enumValues.every((v) => typeof v === 'string')) {
    throw new Error('MetricsV1Name enum must be string-only')
  }
  return (enumValues as string[]).slice().sort()
}

/**
 * Convert a wire metric name like `copilot.request.duration` into an
 * identifier-safe PascalCase key like `CopilotRequestDuration`. Same algorithm
 * as the trace-attributes sync script so readers learn one and reuse it.
 */
function toIdentifier(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) {
    throw new Error(`Cannot derive identifier for metric name: ${name}`)
  }
  const ident = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('')
  if (/^[0-9]/.test(ident)) {
    throw new Error(`Derived identifier "${ident}" for metric "${name}" starts with a digit`)
  }
  return ident
}

function render(metricNames: string[]): string {
  const pairs = metricNames.map((name) => ({ name, ident: toIdentifier(name) }))

  const seen = new Map<string, string>()
  for (const p of pairs) {
    const prev = seen.get(p.ident)
    if (prev && prev !== p.name) {
      throw new Error(`Identifier collision: "${prev}" and "${p.name}" both map to "${p.ident}"`)
    }
    seen.set(p.ident, p.name)
  }

  const constLines = pairs.map((p) => `  ${p.ident}: ${JSON.stringify(p.name)},`).join('\n')
  const arrayEntries = metricNames.map((n) => `  ${JSON.stringify(n)},`).join('\n')

  return `// AUTO-GENERATED FILE. DO NOT EDIT.
//
// Source: copilot/copilot/contracts/metrics-v1.schema.json
// Regenerate with: bun run metrics-contract:generate
//
// Canonical mothership OTel metric names. Call sites should reference
// \`Metric.<Identifier>\` (e.g. \`Metric.CopilotToolDuration\`) rather than raw
// string literals, so the Go-side contract is the single source of truth and
// typos become compile errors.
//
// NAMES ONLY. Label keys and histogram bucket boundaries are NOT in this
// contract — Go owns the label-cardinality allowlist and the shared bucket
// constant, and the Sim emitter MUST mirror those by hand so the Go∪Sim metric
// union is queryable as one series set.

export const Metric = {
${constLines}
} as const;

export type MetricKey = keyof typeof Metric;
export type MetricValue = (typeof Metric)[MetricKey];

/** Readonly sorted list of every canonical mothership metric name. */
export const MetricValues: readonly MetricValue[] = [
${arrayEntries}
] as const;
`
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const inputArg = process.argv.find((a) => a.startsWith('--input='))
  const inputPath = inputArg
    ? resolve(ROOT, inputArg.slice('--input='.length))
    : DEFAULT_CONTRACT_PATH

  const raw = await readFile(inputPath, 'utf8')
  const schema = JSON.parse(raw)
  const metricNames = extractMetricNames(schema)
  const rendered = formatGeneratedSource(render(metricNames), OUTPUT_PATH, ROOT)

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered) {
      throw new Error('Generated metrics contract is stale. Run: bun run metrics-contract:generate')
    }
    console.log('Metrics contract is up to date.')
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
  console.log(`Generated metrics types -> ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
