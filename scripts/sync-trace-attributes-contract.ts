import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Generate `apps/sim/lib/copilot/generated/trace-attributes-v1.ts`
 * from the Go-side `contracts/trace-attributes-v1.schema.json`
 * contract.
 *
 * The contract is a single-enum JSON Schema listing every CUSTOM
 * (non-OTel-semconv) span attribute key used in mothership. We emit:
 *   - A `TraceAttr` const object keyed by PascalCase identifier whose
 *     values are the exact wire strings, so call sites look like
 *     `span.setAttribute(TraceAttr.ChatId, …)` instead of the raw
 *     `span.setAttribute('chat.id', …)`.
 *   - A `TraceAttrKey` union and a `TraceAttrValue` union type so
 *     helpers that take an attribute key are well-typed.
 *   - A sorted `TraceAttrValues` readonly array for tests/enumeration.
 *
 * This is the attribute-key twin of `sync-trace-spans-contract.ts`
 * (span names). The two files share the enum-extraction + identifier
 * PascalCase + collision-detection pattern so a reader who understands
 * one understands both.
 *
 * For OTel semantic-convention keys (e.g. `http.request.method`,
 * `db.system`, `gen_ai.system`, `messaging.*`, `net.*`,
 * `service.name`, `deployment.environment`), import from
 * `@opentelemetry/semantic-conventions` directly — they live in the
 * upstream package, not in this contract.
 */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CONTRACT_PATH = resolve(
  ROOT,
  '../copilot/copilot/contracts/trace-attributes-v1.schema.json',
)
const OUTPUT_PATH = resolve(
  ROOT,
  'apps/sim/lib/copilot/generated/trace-attributes-v1.ts',
)

function extractAttrKeys(schema: Record<string, unknown>): string[] {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>
  const nameDef = defs.TraceAttributesV1Name
  if (
    !nameDef ||
    typeof nameDef !== 'object' ||
    !Array.isArray((nameDef as Record<string, unknown>).enum)
  ) {
    throw new Error(
      'trace-attributes-v1.schema.json is missing $defs.TraceAttributesV1Name.enum',
    )
  }
  const enumValues = (nameDef as Record<string, unknown>).enum as unknown[]
  if (!enumValues.every((v) => typeof v === 'string')) {
    throw new Error('TraceAttributesV1Name enum must be string-only')
  }
  return (enumValues as string[]).slice().sort()
}

/**
 * Convert a wire attribute key like `copilot.vfs.input.media_type_claimed`
 * into an identifier-safe PascalCase key like
 * `CopilotVfsInputMediaTypeClaimed`.
 *
 * Same algorithm as the span-name sync script so readers can learn one
 * and reuse it.
 */
function toIdentifier(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) {
    throw new Error(`Cannot derive identifier for attribute key: ${name}`)
  }
  const ident = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('')
  if (/^[0-9]/.test(ident)) {
    throw new Error(
      `Derived identifier "${ident}" for attribute "${name}" starts with a digit`,
    )
  }
  return ident
}

function render(attrKeys: string[]): string {
  const pairs = attrKeys.map((name) => ({ name, ident: toIdentifier(name) }))

  // Identifier collisions silently override earlier keys and break
  // type safety — fail loudly instead.
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
  const arrayEntries = attrKeys.map((n) => `  ${JSON.stringify(n)},`).join('\n')

  return `// AUTO-GENERATED FILE. DO NOT EDIT.
//
// Source: copilot/copilot/contracts/trace-attributes-v1.schema.json
// Regenerate with: bun run trace-attributes-contract:generate
//
// Canonical custom mothership OTel span attribute keys. Call sites
// should reference \`TraceAttr.<Identifier>\` (e.g.
// \`TraceAttr.ChatId\`, \`TraceAttr.ToolCallId\`) rather than raw
// string literals, so the Go-side contract is the single source of
// truth and typos become compile errors.
//
// For OTel semantic-convention keys (\`http.*\`, \`db.*\`,
// \`gen_ai.*\`, \`net.*\`, \`messaging.*\`, \`service.*\`,
// \`deployment.environment\`), import from
// \`@opentelemetry/semantic-conventions\` directly — those are owned
// by the upstream OTel spec, not by this contract.

export const TraceAttr = {
${constLines}
} as const;

export type TraceAttrKey = keyof typeof TraceAttr;
export type TraceAttrValue = (typeof TraceAttr)[TraceAttrKey];

/** Readonly sorted list of every canonical custom attribute key. */
export const TraceAttrValues: readonly TraceAttrValue[] = [
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
  const attrKeys = extractAttrKeys(schema)
  const rendered = render(attrKeys)

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered) {
      throw new Error(
        'Generated trace attributes contract is stale. Run: bun run trace-attributes-contract:generate',
      )
    }
    console.log('Trace attributes contract is up to date.')
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
  console.log(`Generated trace attributes types -> ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
