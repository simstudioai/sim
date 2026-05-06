import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Generate `apps/sim/lib/copilot/generated/trace-attribute-values-v1.ts`
 * from the Go-side `contracts/trace-attribute-values-v1.schema.json`
 * contract.
 *
 * Unlike span-names / attribute-keys / event-names (each of which is a
 * single enum), this contract carries MULTIPLE enums — one per span
 * attribute whose value set is closed. The schema's `$defs` holds one
 * definition per enum (e.g. `CopilotRequestCancelReason`,
 * `CopilotAbortOutcome`, …). For each $def we emit a TS `as const`
 * object named after the Go type, so call sites read as:
 *
 *     span.setAttribute(
 *       TraceAttr.CopilotRequestCancelReason,
 *       CopilotRequestCancelReason.ExplicitStop,
 *     )
 *
 * Skipped $defs: anything that doesn't have a string-only `enum`
 * array. That filters out wrapper structs the reflector adds
 * incidentally (e.g. `TraceAttributeValuesV1AllDefs`).
 */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CONTRACT_PATH = resolve(
  ROOT,
  '../copilot/copilot/contracts/trace-attribute-values-v1.schema.json',
)
const OUTPUT_PATH = resolve(
  ROOT,
  'apps/sim/lib/copilot/generated/trace-attribute-values-v1.ts',
)

interface ExtractedEnum {
  /** The Go type name — becomes the TS const + type name. */
  name: string
  /** The value strings, sorted for diff stability. */
  values: string[]
}

function extractEnums(schema: Record<string, unknown>): ExtractedEnum[] {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>
  const out: ExtractedEnum[] = []
  for (const [name, def] of Object.entries(defs)) {
    if (!def || typeof def !== 'object') continue
    const enumValues = (def as Record<string, unknown>).enum
    if (!Array.isArray(enumValues)) continue
    if (!enumValues.every((v) => typeof v === 'string')) continue
    out.push({ name, values: (enumValues as string[]).slice().sort() })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * PascalCase identifier for a wire enum value. Mirrors the algorithm
 * used by the span-names + attribute-keys scripts, so
 * `explicit_stop` -> `ExplicitStop`, matching what a reader would
 * guess from Go's exported constants.
 */
function toValueIdent(value: string): string {
  const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) {
    throw new Error(`Cannot derive identifier for enum value: ${value}`)
  }
  const ident = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('')
  if (/^[0-9]/.test(ident)) {
    throw new Error(
      `Derived identifier "${ident}" for value "${value}" starts with a digit`,
    )
  }
  return ident
}

function renderEnum(e: ExtractedEnum): string {
  const seen = new Map<string, string>()
  const lines = e.values.map((v) => {
    const ident = toValueIdent(v)
    const prev = seen.get(ident)
    if (prev && prev !== v) {
      throw new Error(
        `Enum ${e.name}: identifier collision — "${prev}" and "${v}" both map to "${ident}"`,
      )
    }
    seen.set(ident, v)
    return `  ${ident}: ${JSON.stringify(v)},`
  })

  return `export const ${e.name} = {
${lines.join('\n')}
} as const;

export type ${e.name}Key = keyof typeof ${e.name};
export type ${e.name}Value = (typeof ${e.name})[${e.name}Key];`
}

function render(enums: ExtractedEnum[]): string {
  const body = enums.map(renderEnum).join('\n\n')
  return `// AUTO-GENERATED FILE. DO NOT EDIT.
//
// Source: copilot/copilot/contracts/trace-attribute-values-v1.schema.json
// Regenerate with: bun run trace-attribute-values-contract:generate
//
// Canonical closed-set value vocabularies for mothership OTel
// attributes. Call sites should reference e.g.
// \`CopilotRequestCancelReason.ExplicitStop\` rather than the raw
// string literal, so typos become compile errors and the Go contract
// remains the single source of truth.

${body}
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
  const enums = extractEnums(schema)
  if (enums.length === 0) {
    throw new Error(
      'No enum $defs found in trace-attribute-values-v1.schema.json — did you add the Go type to TraceAttributeValuesV1AllDefs?',
    )
  }
  const rendered = render(enums)

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered) {
      throw new Error(
        'Generated trace attribute values contract is stale. Run: bun run trace-attribute-values-contract:generate',
      )
    }
    console.log('Trace attribute values contract is up to date.')
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
  console.log(`Generated trace attribute values types -> ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
