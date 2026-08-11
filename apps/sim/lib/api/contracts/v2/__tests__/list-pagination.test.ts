/**
 * @vitest-environment node
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

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

/** Unwraps `.optional()` / `.default()` / `.superRefine()` / pipe wrappers to the object underneath. */
function objectShape(schema: z.ZodType | undefined): Record<string, unknown> | null {
  let current: unknown = schema
  for (let depth = 0; current && depth < 8; depth++) {
    const def = (current as { def?: Record<string, unknown> }).def
    if (!def) return null
    if (def.type === 'object') return def.shape as Record<string, unknown>
    current = def.innerType ?? def.in ?? def.schema
  }
  return null
}

/** A `{ data: T[], nextCursor: string | null }` response. */
function isListResponse(schema: z.ZodType | undefined): boolean {
  const shape = objectShape(schema)
  return !!shape && 'data' in shape && 'nextCursor' in shape
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
  paginationParams: string[]
}

async function loadV2ListContracts(): Promise<V2ListContract[]> {
  const found = new Map<string, V2ListContract>()
  for (const file of listContractFiles(CONTRACTS_DIR)) {
    const mod = (await import(file)) as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) {
      if (!isContract(value)) continue
      if (!value.path.startsWith('/api/v2/')) continue
      if (!isListResponse(value.response?.schema)) continue
      const key = `${value.method.toUpperCase()} ${value.path}`
      if (found.has(key)) continue
      const inputShape = { ...objectShape(value.query), ...objectShape(value.body) }
      found.set(key, {
        key,
        name,
        paginationParams: ['limit', 'cursor'].filter((param) => param in inputShape),
      })
    }
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key))
}

describe('v2 list pagination split', () => {
  it('classifies every v2 list as paged or full-set', async () => {
    const contracts = await loadV2ListContracts()
    const classified = new Set<string>([...PAGED_LISTS, ...FULL_SET_LISTS])
    const unclassified = contracts.filter((c) => !classified.has(c.key)).map((c) => c.key)

    expect(
      unclassified,
      'A new v2 list must be added to PAGED_LISTS or FULL_SET_LISTS, and to the enumeration in v2/shared.ts.'
    ).toEqual([])
    expect(contracts.map((c) => c.key).sort()).toEqual([...classified].sort())
  })

  it('gives every paged list both limit and cursor', async () => {
    const contracts = await loadV2ListContracts()
    const byKey = new Map(contracts.map((c) => [c.key, c]))

    for (const key of PAGED_LISTS) {
      expect(byKey.get(key)?.paginationParams, `${key} is declared paged`).toEqual([
        'limit',
        'cursor',
      ])
    }
  })

  it('gives every full-set list neither limit nor cursor', async () => {
    const contracts = await loadV2ListContracts()
    const byKey = new Map(contracts.map((c) => [c.key, c]))

    for (const key of FULL_SET_LISTS) {
      expect(
        byKey.get(key)?.paginationParams,
        `${key} returns the full set; adding a defaulted limit would truncate existing callers`
      ).toEqual([])
    }
  })
})
