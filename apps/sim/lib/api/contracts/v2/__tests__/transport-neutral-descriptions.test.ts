/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { listContractFiles } from '@/lib/api/contracts/v2/__tests__/contract-sweep'
import { MAX_SCHEMA_DEPTH } from '@/lib/api/contracts/v2/__tests__/schema-introspection'

/**
 * Shared descriptions appear in API documentation and CLI help. Name related
 * operations instead of HTTP paths so instructions work on both surfaces.
 */
const ENDPOINT_SPELLING = /\b(GET|POST|PATCH|PUT|DELETE)\s+\//

interface Described {
  /** `file.ts#exportName.field`, so a failure names the symbol to edit. */
  key: string
  description: string
}

function describedOf(node: unknown): string | undefined {
  const described = node as { description?: unknown; meta?: () => { description?: unknown } }
  if (typeof described?.description === 'string') return described.description
  const meta = typeof described?.meta === 'function' ? described.meta() : undefined
  return typeof meta?.description === 'string' ? meta.description : undefined
}

function collect(node: unknown, key: string, seen: Set<unknown>, out: Described[], depth: number) {
  if (!node || typeof node !== 'object' || depth <= 0 || seen.has(node)) return
  seen.add(node)
  const def = (node as { def?: Record<string, unknown> }).def
  if (!def) return

  const description = describedOf(node)
  if (description) out.push({ key, description })

  for (const wrapper of ['innerType', 'in', 'out', 'schema', 'element', 'valueType', 'keyType']) {
    if (def[wrapper]) collect(def[wrapper], key, seen, out, depth - 1)
  }
  if (typeof def.getter === 'function') {
    /**
     * A `lazy` schema hides its shape behind a getter, and the depth cap is what
     * keeps a self-referential one from spinning. A getter that throws is not
     * this sweep's business, so it is skipped rather than failing the run.
     */
    try {
      collect((def.getter as () => unknown)(), key, seen, out, depth - 1)
    } catch {}
  }
  for (const option of (def.options as unknown[] | undefined) ?? []) {
    collect(option, key, seen, out, depth - 1)
  }
  for (const [field, child] of Object.entries(
    (def.shape as Record<string, unknown> | undefined) ?? {}
  )) {
    collect(child, `${key}.${field}`, seen, out, depth - 1)
  }
}

/** Every description reachable from an exported schema or route contract. */
async function sweepDescriptions(): Promise<Described[]> {
  const out: Described[] = []
  for (const file of listContractFiles().filter((path) => path.includes('/contracts/v2/'))) {
    const name = file.split('/contracts/v2/')[1]
    const module = (await import(file)) as Record<string, unknown>
    for (const [exported, value] of Object.entries(module)) {
      if (!value || typeof value !== 'object') continue
      /**
       * A fresh visited set per export: schemas are shared between contracts, and
       * deduplicating across them would report a shared field under whichever
       * export reached it first and hide the rest.
       */
      const seen = new Set<unknown>()
      const key = `${name}#${exported}`
      if ('def' in value) {
        collect(value, key, seen, out, MAX_SCHEMA_DEPTH)
        continue
      }
      const contract = value as {
        params?: unknown
        query?: unknown
        body?: unknown
        headers?: unknown
        response?: { schema?: unknown }
      }
      for (const slot of ['params', 'query', 'body', 'headers'] as const) {
        if (contract[slot]) collect(contract[slot], `${key}.${slot}`, seen, out, MAX_SCHEMA_DEPTH)
      }
      if (contract.response?.schema) {
        collect(contract.response.schema, `${key}.response`, seen, out, MAX_SCHEMA_DEPTH)
      }
    }
  }
  return out
}

function offendingDescriptions(described: Described[]): Map<string, string[]> {
  const byDescription = new Map<string, string[]>()
  for (const { key, description } of described) {
    if (!ENDPOINT_SPELLING.test(description)) continue
    const keys = byDescription.get(description)
    if (keys) keys.push(key)
    else byDescription.set(description, [key])
  }
  return byDescription
}

describe('v2 schema descriptions', () => {
  it('name the operation rather than an HTTP method and path', async () => {
    const described = await sweepDescriptions()
    expect(described.length).toBeGreaterThan(1000)

    const unexpected = [...offendingDescriptions(described)].map(
      ([description, keys]) => `${keys[0]} :: ${description}`
    )

    expect(unexpected).toEqual([])
  })
})
