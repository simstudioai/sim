import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Generate `apps/sim/lib/copilot/generated/trace-events-v1.ts` from
 * the Go-side `contracts/trace-events-v1.schema.json` contract.
 *
 * Mirrors the span-names + attribute-keys sync scripts exactly — the
 * only difference is the $defs key (`TraceEventsV1Name`), the output
 * path, and the generated const name (`TraceEvent`). Keeping the
 * scripts structurally identical means a reader who understands one
 * understands all three, and drift between them gets caught
 * immediately in code review.
 */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CONTRACT_PATH = resolve(
  ROOT,
  '../copilot/copilot/contracts/trace-events-v1.schema.json',
)
const OUTPUT_PATH = resolve(
  ROOT,
  'apps/sim/lib/copilot/generated/trace-events-v1.ts',
)

function extractEventNames(schema: Record<string, unknown>): string[] {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>
  const nameDef = defs.TraceEventsV1Name
  if (
    !nameDef ||
    typeof nameDef !== 'object' ||
    !Array.isArray((nameDef as Record<string, unknown>).enum)
  ) {
    throw new Error(
      'trace-events-v1.schema.json is missing $defs.TraceEventsV1Name.enum',
    )
  }
  const enumValues = (nameDef as Record<string, unknown>).enum as unknown[]
  if (!enumValues.every((v) => typeof v === 'string')) {
    throw new Error('TraceEventsV1Name enum must be string-only')
  }
  return (enumValues as string[]).slice().sort()
}

function toIdentifier(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) {
    throw new Error(`Cannot derive identifier for event name: ${name}`)
  }
  const ident = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('')
  if (/^[0-9]/.test(ident)) {
    throw new Error(
      `Derived identifier "${ident}" for event "${name}" starts with a digit`,
    )
  }
  return ident
}

function render(eventNames: string[]): string {
  const pairs = eventNames.map((name) => ({ name, ident: toIdentifier(name) }))

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
  const arrayEntries = eventNames.map((n) => `  ${JSON.stringify(n)},`).join('\n')

  return `// AUTO-GENERATED FILE. DO NOT EDIT.
//
// Source: copilot/copilot/contracts/trace-events-v1.schema.json
// Regenerate with: bun run trace-events-contract:generate
//
// Canonical mothership OTel span event names. Call sites should
// reference \`TraceEvent.<Identifier>\` (e.g.
// \`TraceEvent.RequestCancelled\`) rather than raw string literals,
// so the Go-side contract is the single source of truth and typos
// become compile errors.

export const TraceEvent = {
${constLines}
} as const;

export type TraceEventKey = keyof typeof TraceEvent;
export type TraceEventValue = (typeof TraceEvent)[TraceEventKey];

/** Readonly sorted list of every canonical event name. */
export const TraceEventValues: readonly TraceEventValue[] = [
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
  const eventNames = extractEventNames(schema)
  const rendered = render(eventNames)

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered) {
      throw new Error(
        'Generated trace events contract is stale. Run: bun run trace-events-contract:generate',
      )
    }
    console.log('Trace events contract is up to date.')
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
  console.log(`Generated trace events types -> ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
