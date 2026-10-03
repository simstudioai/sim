#!/usr/bin/env bun
/**
 * Projects the executable tool registry down to its serializable metadata.
 *
 * `apps/sim/tools/registry.ts` is a ~9,000-line barrel importing all 4,300+
 * tools. Each `ToolConfig` mixes plain data (`params`, `outputs`, `name`) with
 * closures (`request.headers`, `transformResponse`,
 * `postProcess`), and it is those closures — and the SDK clients and API
 * helpers they reach — that make the barrel cost ~4,700 modules to compile.
 *
 * No client-reachable caller needs a closure. They need `outputs` (block output
 * inference), `params` (serialization and the tool-input panel), or merely
 * whether an id exists. So this script emits that data on its own, letting those
 * callers read tool metadata without pulling the registry.
 *
 * Two artifacts rather than one, because `outputs` is ~4 MB of the ~6 MB and has
 * a single consumer — keeping it separate means callers that only need `params`
 * or an id check don't pay for it:
 *
 *   tools/generated/tool-ids.ts        every registered tool id
 *   tools/generated/tool-metadata.ts   id -> { name, description, version, params, oauth }
 *   tools/generated/tool-outputs.ts    id -> outputs
 *
 * Ids are their own artifact because resolving a possibly-unversioned tool name
 * needs only the key set, and an existence check needs nothing more — so those
 * callers load ~100 KB instead of ~4 MB.
 *
 * Each artifact holds its data as one JSON string parsed at runtime — see
 * `serialize()` for why an imported `.json` or an object literal is not viable
 * at this size.
 *
 * Usage:
 *   bun run scripts/sync-tool-metadata.ts           # write artifacts
 *   bun run scripts/sync-tool-metadata.ts --check    # fail (exit 1) if stale
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveHostedApiKeySupport } from '../apps/sim/tools/hosted-api-key'
import { tools } from '../apps/sim/tools/registry'
import { hasToolId } from '../apps/sim/tools/tool-ids'
import type { ToolConfig } from '../apps/sim/tools/types'
import { getTool } from '../apps/sim/tools/utils'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const GENERATED_DIR = resolve(ROOT, 'apps/sim/tools/generated')
const IDS_PATH = resolve(GENERATED_DIR, 'tool-ids.ts')
const METADATA_PATH = resolve(GENERATED_DIR, 'tool-metadata.ts')
const OUTPUTS_PATH = resolve(GENERATED_DIR, 'tool-outputs.ts')

/**
 * Fields copied into `tool-metadata.ts`. Every one must be plain data.
 *
 * Deliberately excluded: `request`, `transformResponse`,
 * `postProcess` (closures, and the whole reason the registry is expensive);
 * `hosting` and `schemaEnrichment` (contain predicates/`enrichSchema`, and are
 * only consumed server-side); `outputs` (emitted separately).
 *
 * `hosting` is excluded but not lost: `hostedApiKey` below carries the one bit
 * of it a caller needs, derived into plain data.
 */
const METADATA_FIELDS = [
  'name',
  'description',
  'version',
  'params',
  'oauth',
  'personalToken',
] as const

type ToolRecord = Record<string, ToolConfig>

/**
 * Recursively locates any function value, which must never reach the artifacts.
 *
 * Unbounded in depth on purpose: param and output schemas nest arbitrarily, and
 * a depth cap would let a deeply-nested closure through — `JSON.stringify` drops
 * it silently, so the artifact would ship an incomplete schema while generation
 * reported success. `seen` guards the cycles that removing the cap exposes.
 */
function findFunctionPaths(
  value: unknown,
  path: string,
  found: string[],
  seen = new WeakSet<object>()
): void {
  if (found.length >= 10 || value == null) return
  if (typeof value === 'function') {
    found.push(path)
    return
  }
  if (typeof value !== 'object') return
  if (seen.has(value as object)) return
  seen.add(value as object)

  if (Array.isArray(value)) {
    value.forEach((item, i) => findFunctionPaths(item, `${path}[${i}]`, found, seen))
    return
  }
  for (const [key, item] of Object.entries(value as object)) {
    findFunctionPaths(item, `${path}.${key}`, found, seen)
  }
}

/**
 * Drops empty param entries so consumers may iterate params unguarded.
 *
 * The registry contains one (`stt_deepgram_v2`), which crashes any caller that
 * reads `param.type` while iterating. That entry is `undefined`, which
 * `JSON.stringify` would drop anyway; this guard additionally covers an explicit
 * `null` — which serializes faithfully and would reach consumers — and surfaces
 * either case as a warning rather than silently.
 */
function normalizeParams(toolId: string, params: ToolConfig['params'] | undefined) {
  const normalized: Record<string, unknown> = {}
  let dropped = 0
  for (const [paramId, config] of Object.entries(params ?? {})) {
    if (config == null) {
      dropped++
      continue
    }
    normalized[paramId] = config
  }
  if (dropped > 0) {
    console.warn(`[tool-metadata] ${toolId}: dropped ${dropped} empty param entr(y/ies)`)
  }
  return normalized
}

function build(registry: ToolRecord) {
  const metadata: Record<string, unknown> = {}
  const outputs: Record<string, unknown> = {}

  // Sorted so the artifacts are stable across runs regardless of registry order.
  for (const toolId of Object.keys(registry).sort()) {
    const tool = registry[toolId] as ToolConfig & Record<string, unknown>
    if (!tool) continue

    const entry: Record<string, unknown> = { id: tool.id ?? toolId }
    for (const field of METADATA_FIELDS) {
      if (field === 'params') {
        entry.params = normalizeParams(toolId, tool.params)
      } else if (tool[field] !== undefined) {
        entry[field] = tool[field]
      }
    }
    /**
     * Derived, never copied. `hosting` itself holds closures and would trip
     * `findFunctionPaths`; this is the serializable answer to "does Sim supply
     * the API key", which is otherwise only discoverable by reading the tool's
     * source.
     */
    entry.hostedApiKey = deriveHostedApiKeySupport(tool.hosting)
    metadata[toolId] = entry
    if (tool.outputs !== undefined) outputs[toolId] = tool.outputs
  }

  const offenders: string[] = []
  findFunctionPaths(metadata, 'metadata', offenders)
  findFunctionPaths(outputs, 'outputs', offenders)
  if (offenders.length > 0) {
    throw new Error(
      `Refusing to emit tool metadata: found non-serializable values at:\n  ${offenders.join('\n  ')}\n` +
        `Add the offending field to the exclusion list in ${'scripts/sync-tool-metadata.ts'}.`
    )
  }

  return {
    ids: serializeValue(
      Object.keys(metadata),
      'toolIds',
      '/** Every registered tool id, including versioned variants. */',
      'string[]'
    ),
    metadata: serialize(
      metadata,
      'toolMetadata',
      '/** Serializable metadata for every built-in tool, keyed by tool id. */'
    ),
    outputs: serialize(
      outputs,
      'toolOutputs',
      '/** Declared output shapes for every built-in tool, keyed by tool id. */'
    ),
    toolCount: Object.keys(metadata).length,
  }
}

/**
 * Escapes a JSON document into a single-quoted JavaScript string literal.
 *
 * Single quotes rather than double: JSON is dense with `"`, which would need
 * escaping inside a double-quoted literal and inflates the file by ~90%.
 */
function toJsStringLiteral(json: string): string {
  const escaped = json
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    // Valid raw inside a JSON string, but line terminators in a JS literal.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `'${escaped}'`
}

/**
 * Emits the data as a string parsed at runtime, rather than as an object
 * literal or an imported `.json`.
 *
 * Both of the obvious alternatives are unusable at this size. A `.json` import
 * (with `resolveJsonModule`, which this repo enables) makes TypeScript infer a
 * literal type for all 4,300+ entries: it took `tsc --noEmit` from **12.6s to
 * 8m07s**, a 38x regression, and an ambient `declare module` does not
 * short-circuit it. A generated object literal costs the same, since it is the
 * same inference work.
 *
 * A single string literal is one cheap token for the compiler and the bundler,
 * and `JSON.parse` on a large payload is faster at runtime than evaluating the
 * equivalent object literal.
 *
 * The trade-off is that these files diff as one line. That is acceptable for a
 * generated artifact nothing reads by eye and CI verifies wholesale.
 */
function serialize(entries: Record<string, unknown>, exportName: string, doc: string): string {
  return serializeValue(entries, exportName, doc, 'Record<string, unknown>')
}

function serializeValue(value: unknown, exportName: string, doc: string, type: string): string {
  const literal = toJsStringLiteral(JSON.stringify(value))
  return `// Generated by scripts/sync-tool-metadata.ts — do not edit.
// Regenerate with: bun run tool-metadata:generate

${doc}
const ${exportName}: ${type} = JSON.parse(
  ${literal}
)

export default ${exportName}
`
}

/**
 * Asserts the two tool-id resolvers agree.
 *
 * `@/tools/utils` resolves against the live registry; `@/tools/tool-ids` against
 * the generated id list. Both exist deliberately — the registry-backed one keeps
 * a newly-added tool resolvable before regeneration, the list-backed one lets
 * client code resolve without importing 4,300 tools. Nothing structurally keeps
 * the two in step, so it is checked here rather than left to trust.
 *
 * Runs only after the staleness check passes, since a stale id list would
 * otherwise report a divergence that is really just a missing regeneration. It
 * cannot live in a vitest suite: `vitest.setup.ts` globally mocks
 * `@/tools/registry` to an empty map, so `getTool` resolves nothing there.
 */
function assertResolverParity() {
  const ids = Object.keys(tools)
  const probes = new Set([...ids, ...ids.map((id) => id.replace(/_v\d+$/, '')), '__not_a_tool__'])
  const divergent: string[] = []
  for (const probe of probes) {
    if (Boolean(getTool(probe)) !== hasToolId(probe)) divergent.push(probe)
  }
  if (divergent.length > 0) {
    throw new Error(
      `Tool id resolvers disagree on ${divergent.length} of ${probes.size} names ` +
        `(e.g. ${divergent.slice(0, 5).join(', ')}).\n` +
        'resolveToolId in apps/sim/tools/utils.ts and apps/sim/tools/tool-ids.ts have drifted.'
    )
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const { ids, metadata, outputs, toolCount } = build(tools as ToolRecord)

  if (checkOnly) {
    const [existingIds, existingMetadata, existingOutputs] = await Promise.all([
      readFile(IDS_PATH, 'utf8').catch(() => null),
      readFile(METADATA_PATH, 'utf8').catch(() => null),
      readFile(OUTPUTS_PATH, 'utf8').catch(() => null),
    ])
    if (existingIds !== ids || existingMetadata !== metadata || existingOutputs !== outputs) {
      throw new Error('Generated tool metadata is stale. Run: bun run tool-metadata:generate')
    }
    assertResolverParity()
    console.log(`✓ tool metadata in sync (${toolCount} tools), resolvers agree`)
    return
  }

  await mkdir(GENERATED_DIR, { recursive: true })
  await Promise.all([
    writeFile(IDS_PATH, ids, 'utf8'),
    writeFile(METADATA_PATH, metadata, 'utf8'),
    writeFile(OUTPUTS_PATH, outputs, 'utf8'),
  ])
  console.log(`✓ wrote tool metadata for ${toolCount} tools`)
}

await main()
