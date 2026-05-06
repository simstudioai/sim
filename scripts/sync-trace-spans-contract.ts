import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Generate `apps/sim/lib/copilot/generated/trace-spans-v1.ts` from the
 * Go-side `contracts/trace-spans-v1.schema.json` contract.
 *
 * The contract is a single-enum JSON Schema. We emit:
 *   - A `TraceSpansV1Name` const object (key-as-value) for ergonomic
 *     access: `TraceSpansV1Name['copilot.vfs.read_file']`.
 *   - A `TraceSpansV1NameValue` union type.
 *   - A sorted `TraceSpansV1Names` readonly array (useful for tests that
 *     verify coverage, and for tooling that wants to enumerate names).
 *
 * We deliberately do NOT pass through `json-schema-to-typescript` —
 * it would generate a noisy `TraceSpansV1` object type for the wrapper
 * that drives reflection; the wrapper type has no runtime use on the Sim
 * side and would obscure the actual enum.
 */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CONTRACT_PATH = resolve(
  ROOT,
  '../copilot/copilot/contracts/trace-spans-v1.schema.json',
)
const OUTPUT_PATH = resolve(
  ROOT,
  'apps/sim/lib/copilot/generated/trace-spans-v1.ts',
)

function extractSpanNames(schema: Record<string, unknown>): string[] {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>
  const nameDef = defs.TraceSpansV1Name
  if (
    !nameDef ||
    typeof nameDef !== 'object' ||
    !Array.isArray((nameDef as Record<string, unknown>).enum)
  ) {
    throw new Error(
      'trace-spans-v1.schema.json is missing $defs.TraceSpansV1Name.enum',
    )
  }
  const enumValues = (nameDef as Record<string, unknown>).enum as unknown[]
  if (!enumValues.every((v) => typeof v === 'string')) {
    throw new Error('TraceSpansV1Name enum must be string-only')
  }
  return (enumValues as string[]).slice().sort()
}

/**
 * Convert a wire name like "copilot.recovery.check_replay_gap" into an
 * identifier-safe PascalCase key like "CopilotRecoveryCheckReplayGap",
 * so call sites read as `TraceSpan.CopilotRecoveryCheckReplayGap`
 * instead of `TraceSpan["copilot.recovery.check_replay_gap"]`.
 *
 * Splits on `.`, `_`, and non-alphanumeric characters; capitalizes each
 * part; collapses. Strict mapping (not a best-effort heuristic), so the
 * same input always produces the same identifier.
 */
function toIdentifier(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) {
    throw new Error(`Cannot derive identifier for span name: ${name}`)
  }
  const ident = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('')
  // Safety: identifiers may not start with a digit.
  if (/^[0-9]/.test(ident)) {
    throw new Error(
      `Derived identifier "${ident}" for span "${name}" starts with a digit`,
    )
  }
  return ident
}

function render(spanNames: string[]): string {
  const pairs = spanNames.map((name) => ({ name, ident: toIdentifier(name) }))

  // Guard against collisions: if two wire names ever collapse to the
  // same PascalCase identifier, we want a clear build failure, not a
  // silent override.
  const seen = new Map<string, string>()
  for (const p of pairs) {
    const prev = seen.get(p.ident)
    if (prev && prev !== p.name) {
      throw new Error(
        `Identifier collision: "${prev}" and "${p.name}" both map to "${p.ident}"`,
      )
    }
    seen.set(p.ident, p.name)
  }

  const constLines = pairs
    .map((p) => `  ${p.ident}: ${JSON.stringify(p.name)},`)
    .join('\n')
  const arrayEntries = spanNames.map((n) => `  ${JSON.stringify(n)},`).join('\n')

  return `// AUTO-GENERATED FILE. DO NOT EDIT.
//
// Source: copilot/copilot/contracts/trace-spans-v1.schema.json
// Regenerate with: bun run trace-spans-contract:generate
//
// Canonical mothership OTel span names. Call sites should reference
// \`TraceSpan.<Identifier>\` (e.g. \`TraceSpan.CopilotVfsReadFile\`)
// rather than raw string literals, so the Go-side contract is the
// single source of truth and typos become compile errors.

export const TraceSpan = {
${constLines}
} as const;

export type TraceSpanKey = keyof typeof TraceSpan;
export type TraceSpanValue = (typeof TraceSpan)[TraceSpanKey];

/** Readonly sorted list of every canonical span name. */
export const TraceSpanValues: readonly TraceSpanValue[] = [
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
  const spanNames = extractSpanNames(schema)
  const rendered = render(spanNames)

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered) {
      throw new Error(
        'Generated trace spans contract is stale. Run: bun run trace-spans-contract:generate',
      )
    }
    console.log('Trace spans contract is up to date.')
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
  console.log(`Generated trace spans types -> ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
