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

const CONTRACTS_DIR = path.resolve(import.meta.dirname, '..', '..')

export interface SweptContract {
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
      if (entry.name === '__tests__') continue
      files.push(...listContractFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
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
