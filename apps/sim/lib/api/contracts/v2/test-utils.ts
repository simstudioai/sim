import { readdirSync } from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'

/**
 * Shared enumeration of every route contract the v2 surface publishes.
 *
 * The sweeps that assert a cross-cutting v2 promise all need the same thing
 * first: every contract, found by walking the tree rather than by a hand-kept
 * list. A hand-kept list is what let the original fractional-`limit` defect
 * survive on the one endpoint nobody remembered to add, and the same reasoning
 * applies to anything else asserted "for every v2 contract".
 *
 * Contracts are keyed by `METHOD /path`, so a contract re-exported from a barrel
 * is counted once.
 */

const CONTRACTS_DIR = path.resolve(import.meta.dirname, '..')

interface SweptContract {
  method: string
  path: string
  params?: z.ZodType
  query?: z.ZodType
  body?: z.ZodType
  headers?: z.ZodType
  response?: { mode: string; schema?: z.ZodType }
}

export interface SweptContractEntry {
  /** `METHOD /path`, the identity a route is documented under. */
  key: string
  /** The exported binding name, so a failure names the symbol to edit. */
  name: string
  contract: SweptContract
}

function isContract(value: unknown): value is SweptContract {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as SweptContract).method === 'string' &&
    typeof (value as SweptContract).path === 'string' &&
    typeof (value as SweptContract).response === 'object'
  )
}

/** Every non-test `.ts` file under `lib/api/contracts`, deterministically ordered. */
export function listContractFiles(dir: string = CONTRACTS_DIR): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listContractFiles(full))
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      entry.name !== 'test-utils.ts'
    ) {
      files.push(full)
    }
  }
  return files
}

/**
 * Every contract whose path is under `/api/v2/`, first occurrence per key.
 *
 * Costs a few hundred dynamic imports, so callers memoize it for the file rather
 * than repeating it per test.
 */
export async function sweepV2Contracts(): Promise<SweptContractEntry[]> {
  const found = new Map<string, SweptContractEntry>()
  for (const file of listContractFiles()) {
    const mod = (await import(file)) as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) {
      if (!isContract(value)) continue
      if (!value.path.startsWith('/api/v2/')) continue
      const key = `${value.method.toUpperCase()} ${value.path}`
      if (found.has(key)) continue
      found.set(key, { key, name, contract: value })
    }
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Shared Zod introspection for the v2 contract sweeps.
 *
 * Two sweeps ask the same question — "does this schema reject a key it does not
 * declare?" — and each used to carry its own walker with the hole the other
 * filled: the pagination sweep unwrapped wrappers but returned `null` for a
 * union (which it then skipped), and the tables sweep expanded unions but not
 * wrappers. A schema that is both wrapped and union-shaped was reachable by
 * neither. One walker handles both so a strictness claim cannot be vacuous by
 * virtue of which sweep happens to look at it.
 */

/** Depth cap so a self-referential `lazy` schema cannot spin the walk. */
export const MAX_SCHEMA_DEPTH = 12

interface SchemaLike {
  def?: Record<string, unknown>
  safeParse: (value: unknown) => { success: boolean; error?: { issues: readonly unknown[] } }
}

function schemaDef(schema: unknown): Record<string, unknown> | undefined {
  return (schema as { def?: Record<string, unknown> } | undefined)?.def
}

/**
 * Flattens a schema onto the object schemas that actually carry strictness.
 *
 * Wrappers (`.optional()`, `.default()`, pipes) are unwrapped, and a union
 * expands to its members, because a union is only as strict as its weakest
 * member: asserting against the union itself is satisfied by any one strict
 * member, so a sibling that stopped being strict would still sweep green.
 *
 * Note that a Zod 4 `.refine()` is a check on the schema rather than a wrapper,
 * so a refined object still reports `def.type === 'object'` and needs no
 * unwrapping here.
 */
function resolveStrictnessTargets(schema: unknown, depth: number): SchemaLike[] | null {
  if (!schema || depth <= 0) return null
  const def = schemaDef(schema)
  if (!def) return null

  switch (def.type) {
    case 'object':
      return [schema as SchemaLike]
    case 'union': {
      const options = def.options as unknown[] | undefined
      if (!options?.length) return null
      const targets: SchemaLike[] = []
      for (const option of options) {
        const resolved = resolveStrictnessTargets(option, depth - 1)
        if (!resolved) return null
        targets.push(...resolved)
      }
      return targets
    }
    case 'lazy': {
      const getter = def.getter
      if (typeof getter !== 'function') return null
      try {
        return resolveStrictnessTargets(getter(), depth - 1)
      } catch {
        return null
      }
    }
    default: {
      const inner = def.innerType ?? def.in ?? def.schema
      return inner ? resolveStrictnessTargets(inner, depth - 1) : null
    }
  }
}

/** Whether an object schema declares `catchall(never)`, i.e. is `.strict()`. */
function isStrictObject(schema: SchemaLike): boolean {
  const def = schemaDef(schema)
  if (def?.type !== 'object') return false
  return (def.catchall as { def?: { type?: string } } | undefined)?.def?.type === 'never'
}

/**
 * Whether a schema rejects keys it does not declare, i.e. is `.strict()`.
 *
 * This is what separates "this list does not page" from "this list quietly
 * throws your `limit` away". Zod strips unknown keys by default, so a full-set
 * list that is not strict answers `?limit=1` with 200 and the entire set — the
 * caller believes it bounded the response and it did not.
 *
 * Returns `null` when the walk cannot reach an object schema, so an
 * un-introspectable schema fails loudly rather than passing as strict. A union
 * is strict only when **every** member is.
 */
export function rejectsUnknownKeys(
  schema: unknown,
  depth: number = MAX_SCHEMA_DEPTH
): boolean | null {
  const targets = resolveStrictnessTargets(schema, depth)
  if (!targets?.length) return null
  return targets.every(isStrictObject)
}

/**
 * Zod reports a union's member failures nested under the union issue, so a
 * union-bodied contract needs the whole tree walked before "did any member
 * reject the unknown key" can be answered.
 */
export function issueCodes(issues: readonly unknown[]): string[] {
  return issues.flatMap((issue) => {
    const entry = issue as { code?: string; errors?: unknown }
    return [
      ...(entry.code ? [entry.code] : []),
      ...(Array.isArray(entry.errors)
        ? entry.errors.flatMap((nested) => issueCodes(nested as readonly unknown[]))
        : []),
    ]
  })
}
