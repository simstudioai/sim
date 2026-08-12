/**
 * @vitest-environment node
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/**
 * Pins which v2 lists are paged.
 *
 * Every v2 list returns the same `{ data, nextCursor }` envelope, but only some
 * accept `limit` + `cursor` and can return a non-null `nextCursor`. That split
 * is a documented part of the public contract (`v2/shared.ts`) and has already
 * drifted once — `GET /api/v2/tables` gained real pagination while its contract
 * docstring still claimed a single full page. Enumerating the two sets here
 * makes the next such change fail a test instead of rotting a comment, and
 * makes flipping a shipped list from full-set to paged a deliberate edit: a
 * `limit` with a default silently truncates callers that read the full set
 * today.
 *
 * The sweep guarantees, for every contract under `contracts/v2` whose response
 * is `mode: 'json'`:
 *
 * - Its response schema is introspectable down to concrete object variants. A
 *   schema the walk cannot resolve is a hard failure, not a silent pass — a
 *   list hidden behind an opaque schema would otherwise never be discovered and
 *   "classifies every v2 list" would succeed vacuously.
 * - A response counts as a list only when *every* variant carries both `data`
 *   and `nextCursor`. A union where only some variants are list-shaped throws:
 *   that is a genuine design decision (is it paged or not?), not something a
 *   pinning test should quietly pick a side on.
 * - Each discovered list's `query` and `body` are introspectable too, and the
 *   pagination params are read per variant. The full-set assertion uses
 *   *any-member* presence, so a defaulted `limit` added to a single union
 *   member still fails; the paged assertion uses *all-member* presence, so a
 *   paged list must offer `limit` + `cursor` on every accepted input shape.
 *
 * `mode !== 'json'` contracts (binary/stream downloads) are skipped — they have
 * no JSON envelope to classify.
 */

const CONTRACTS_DIR = path.resolve(import.meta.dirname, '..', '..')

/** Lists that accept `limit` + `cursor` and can return a non-null `nextCursor`. */
const PAGED_LISTS = [
  'GET /api/v2/audit-logs',
  'GET /api/v2/billing/logs',
  'GET /api/v2/files',
  'GET /api/v2/knowledge/[id]/documents',
  'GET /api/v2/logs',
  'GET /api/v2/tables',
  'GET /api/v2/tables/[tableId]/rows',
  'POST /api/v2/tables/[tableId]/query',
  'GET /api/v2/workflows',
  'GET /api/v2/workflows/[id]/runs',
  'GET /api/v2/workflows/[id]/versions',
  'GET /api/v2/workspaces/[workspaceId]/members',
] as const

/**
 * Lists that accept neither param and always return `nextCursor: null`, because
 * the set is small and bounded per workspace or per table.
 */
const FULL_SET_LISTS = [
  'GET /api/v2/credentials',
  'GET /api/v2/custom-tools',
  'GET /api/v2/files/folders',
  'GET /api/v2/knowledge',
  'GET /api/v2/knowledge/folders',
  'GET /api/v2/mcp-servers',
  'GET /api/v2/secrets',
  'GET /api/v2/skills',
  'GET /api/v2/tables/[tableId]/groups',
  'GET /api/v2/tables/[tableId]/views',
  'GET /api/v2/tables/folders',
  'GET /api/v2/workflows/folders',
] as const

interface ContractLike {
  method: string
  path: string
  query?: z.ZodType
  body?: z.ZodType
  response?: { mode: string; schema?: z.ZodType }
}

function isContract(value: unknown): value is ContractLike {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ContractLike).method === 'string' &&
    typeof (value as ContractLike).path === 'string' &&
    typeof (value as ContractLike).response === 'object'
  )
}

const MAX_SCHEMA_DEPTH = 12
const PAGINATION_PARAMS = ['limit', 'cursor'] as const

/**
 * Resolves a schema to the key sets of every concrete object variant it can
 * accept, or `null` when it cannot be resolved.
 *
 * Unions contribute one entry per member, intersections the cross-product union
 * of both sides, wrappers (`.optional()` / `.default()` / `.nullable()` /
 * `.catch()` / `.readonly()` / pipes) recurse into the inner (input) type, and
 * `z.lazy` is forced once under the depth cap. Returning `null` rather than an
 * empty shape is what lets callers treat "cannot introspect" as a failure
 * instead of "has no keys".
 */
function variantKeySets(schema: unknown, depth: number = MAX_SCHEMA_DEPTH): string[][] | null {
  if (!schema || depth <= 0) return null
  const def = (schema as { def?: Record<string, unknown> }).def
  if (!def) return null

  switch (def.type) {
    case 'object':
      return [Object.keys(def.shape as Record<string, unknown>)]
    case 'union': {
      const options = def.options as unknown[] | undefined
      if (!options?.length) return null
      const variants: string[][] = []
      for (const option of options) {
        const sets = variantKeySets(option, depth - 1)
        if (!sets) return null
        variants.push(...sets)
      }
      return variants
    }
    case 'intersection': {
      const left = variantKeySets(def.left, depth - 1)
      const right = variantKeySets(def.right, depth - 1)
      if (!left || !right) return null
      return left.flatMap((l) => right.map((r) => [...new Set([...l, ...r])]))
    }
    case 'lazy': {
      const getter = def.getter
      if (typeof getter !== 'function') return null
      try {
        return variantKeySets(getter(), depth - 1)
      } catch {
        return null
      }
    }
    default: {
      const inner = def.innerType ?? def.in ?? def.schema
      return inner ? variantKeySets(inner, depth - 1) : null
    }
  }
}

/**
 * Whether a response is the `{ data, nextCursor }` envelope. Throws when the
 * schema is opaque, or when a union is only partly list-shaped.
 */
function isListResponse(label: string, schema: z.ZodType | undefined): boolean {
  const variants = variantKeySets(schema)
  if (!variants) {
    throw new Error(
      `${label}: v2 json response schema could not be introspected. Teach variantKeySets about it — an opaque response silently hides a list from this sweep.`
    )
  }
  const listy = variants.filter((keys) => keys.includes('data') && keys.includes('nextCursor'))
  if (listy.length === 0) return false
  if (listy.length === variants.length) return true
  throw new Error(
    `${label}: response union mixes ${listy.length} list-shaped variant(s) with ${
      variants.length - listy.length
    } non-list variant(s). Whether this endpoint is paged must be a deliberate decision, not an accident of union ordering.`
  )
}

/** Key sets of every input shape the contract accepts across `query` × `body`. */
function inputVariants(label: string, contract: ContractLike): string[][] {
  let variants: string[][] = [[]]
  for (const [slot, schema] of [
    ['query', contract.query],
    ['body', contract.body],
  ] as const) {
    if (!schema) continue
    const sets = variantKeySets(schema)
    if (!sets) {
      throw new Error(
        `${label}: ${slot} schema of a v2 list could not be introspected, so its pagination params cannot be checked.`
      )
    }
    variants = variants.flatMap((base) => sets.map((s) => [...new Set([...base, ...s])]))
  }
  return variants
}

/**
 * `any` fails a full-set list the moment one input shape gains a pagination
 * param; `all` requires a paged list to offer them on every input shape.
 */
function paginationParams(variants: string[][]): { any: string[]; all: string[] } {
  return {
    any: PAGINATION_PARAMS.filter((param) => variants.some((keys) => keys.includes(param))),
    all: PAGINATION_PARAMS.filter((param) => variants.every((keys) => keys.includes(param))),
  }
}

function listContractFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      files.push(...listContractFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full)
    }
  }
  return files
}

interface V2ListContract {
  key: string
  name: string
  params: { any: string[]; all: string[] }
}

/**
 * Sweeping the contracts tree costs a few hundred dynamic imports, so it is done
 * once for the whole file rather than repeated per test.
 */
let contractsPromise: Promise<V2ListContract[]> | null = null
function loadV2ListContracts(): Promise<V2ListContract[]> {
  contractsPromise ??= sweepV2ListContracts()
  return contractsPromise
}

async function sweepV2ListContracts(): Promise<V2ListContract[]> {
  const found = new Map<string, V2ListContract>()
  for (const file of listContractFiles(CONTRACTS_DIR)) {
    const mod = (await import(file)) as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) {
      if (!isContract(value)) continue
      if (!value.path.startsWith('/api/v2/')) continue
      if (value.response?.mode !== 'json') continue
      const key = `${value.method.toUpperCase()} ${value.path}`
      const label = `${name} (${key})`
      if (!isListResponse(label, value.response?.schema)) continue
      if (found.has(key)) continue
      found.set(key, { key, name, params: paginationParams(inputVariants(label, value)) })
    }
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Only the first test pays for the sweep; the rest await the memoized promise.
 * It costs ~2s standalone but has exceeded the default 10s under full-suite
 * thread contention, so it gets headroom the other two do not need.
 */
const SWEEP_TIMEOUT_MS = 60_000

describe('v2 list pagination split', () => {
  it(
    'classifies every v2 list as paged or full-set',
    async () => {
      const contracts = await loadV2ListContracts()
      const classified = new Set<string>([...PAGED_LISTS, ...FULL_SET_LISTS])
      const unclassified = contracts.filter((c) => !classified.has(c.key)).map((c) => c.key)

      expect(
        unclassified,
        'A new v2 list must be classified in PAGED_LISTS or FULL_SET_LISTS.'
      ).toEqual([])
      expect(contracts.map((c) => c.key).sort()).toEqual([...classified].sort())
    },
    SWEEP_TIMEOUT_MS
  )

  it('gives every paged list both limit and cursor', async () => {
    const contracts = await loadV2ListContracts()
    const byKey = new Map(contracts.map((c) => [c.key, c]))

    for (const key of PAGED_LISTS) {
      expect(
        byKey.get(key)?.params.all,
        `${key} is declared paged, so every input shape it accepts must offer limit and cursor`
      ).toEqual(['limit', 'cursor'])
    }
  })

  it('gives every full-set list neither limit nor cursor', async () => {
    const contracts = await loadV2ListContracts()
    const byKey = new Map(contracts.map((c) => [c.key, c]))

    for (const key of FULL_SET_LISTS) {
      expect(
        byKey.get(key)?.params.any,
        `${key} returns the full set; adding a defaulted limit to any accepted input shape would truncate existing callers`
      ).toEqual([])
    }
  })

  it('sees a pagination param hidden in a single union member', () => {
    const unionQuery = z.union([
      z.object({ workspaceId: z.string(), limit: z.coerce.number().default(50) }),
      z.object({ workspaceId: z.string() }),
    ])
    const variants = inputVariants('synthetic union query', {
      method: 'GET',
      path: '/api/v2/synthetic',
      query: unionQuery,
    })

    expect(variants).toEqual([['workspaceId', 'limit'], ['workspaceId']])
    expect(paginationParams(variants).any).toEqual(['limit'])
    expect(paginationParams(variants).all).toEqual([])
  })

  it('refuses to classify a schema it cannot introspect', () => {
    expect(() => isListResponse('synthetic opaque', z.string())).toThrow(
      /could not be introspected/
    )
    expect(() =>
      isListResponse(
        'synthetic ambiguous',
        z.union([
          z.object({ data: z.array(z.string()), nextCursor: z.string().nullable() }),
          z.object({ error: z.string() }),
        ])
      )
    ).toThrow(/mixes 1 list-shaped variant/)
  })
})
