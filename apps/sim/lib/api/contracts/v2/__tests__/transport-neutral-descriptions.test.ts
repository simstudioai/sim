/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { listContractFiles } from '@/lib/api/contracts/v2/__tests__/contract-sweep'
import { MAX_SCHEMA_DEPTH } from '@/lib/api/contracts/v2/__tests__/schema-introspection'

/**
 * Every v2 schema description is user-facing prose on two surfaces at once: the
 * published API reference and `sim <command> --help`, which is generated from
 * these exact strings. A description spelling an HTTP method and path tells a
 * CLI caller to do something the CLI cannot do, so descriptions name the
 * operation and its object rather than the transport.
 *
 * This is a sweep rather than a handful of per-file assertions because the
 * strings that regressed last time sat a few lines from ones already fixed by
 * hand. Anything deliberately left alone goes in ALLOWED below with its reason,
 * and the sweep fails when an allowlisted description no longer appears, so the
 * list cannot rot.
 *
 * Allowlisting is keyed by the description text, not by schema path: these
 * schemas are shared between contracts, so one sentence surfaces under many
 * paths and fixing it must clear every one of them at once.
 */

const ENDPOINT_SPELLING = /\b(GET|POST|PATCH|PUT|DELETE)\s+\//

/**
 * Descriptions still naming a transport, deferred rather than endorsed. Each one
 * lives in a v2 contract file this change does not touch, and the reason names
 * that file so a later pass knows where to go. The second test below fails as
 * soon as one of these stops offending, so a fix elsewhere cannot leave a stale
 * entry behind.
 */
const ALLOWED = new Map<string, string>([
  [
    'Tag definition identifier. Published because `PATCH` and `DELETE /knowledge/{knowledgeBaseId}/tags/{tagId}` address a definition by it; without it those operations are unreachable from a list read.',
    'not touched here: lives in v2/knowledge.ts',
  ],
  [
    'Tag definition identifier. Published for the same reason the vocabulary read publishes it: `PATCH` and `DELETE /knowledge/{knowledgeBaseId}/tags/{tagId}` address a definition by id, so without it a usage row cannot be acted on without a second read and a slot join.',
    'not touched here: lives in v2/knowledge-tags.ts',
  ],
  [
    'Document tag values keyed by tag display name. Writes address the same tags by slot (`tag1`..`tag7`); resolve names to slots with GET /api/v2/knowledge/{knowledgeBaseId}/tags.',
    'not touched here: lives in v2/knowledge.ts',
  ],
  [
    'ISO 8601 timestamp when the knowledge base was archived by `DELETE /knowledge/{knowledgeBaseId}`, or null while the knowledge base is active. Only `GET /knowledge?scope=archived` returns knowledge bases with a non-null value.',
    'not touched here: lives in v2/knowledge.ts',
  ],
  [
    'Which lifecycle set to list: `active` (default) for live knowledge bases, `archived` for knowledge bases a `DELETE` archived and `POST /knowledge/{knowledgeBaseId}/restore` can bring back. `folderPath` resolves against active folders only, so pairing it with `scope=archived` returns an empty page when the containing folder was archived too.',
    'not touched here: lives in v2/knowledge.ts',
  ],
  [
    'Runs that finished successfully. Failed, cancelled, and paused runs are not counted, and the counter is never reduced when a run ages out of log retention — so it does not match the size of `GET /api/v2/workflows/{workflowId}/runs`, in either direction.',
    'not touched here: lives in v2/workflows.ts',
  ],
  [
    'The workflow was archived, not erased. Its schedules, webhooks, MCP tools, and chats were archived with it, and `POST /workflows/{workflowId}/restore` brings all of them back.',
    'not touched here: lives in v2/workflows.ts',
  ],
  [
    'Whether the deployed workflow accepts unauthenticated public API execution. While true, anyone holding the execution URL can run the workflow — and be billed for it — without an API key, so this is the field an audit of what a deployment exposes reads. Changed with `PATCH /workflows/{workflowId}/deployment`.',
    'not touched here: lives in v2/workflows.ts',
  ],
  [
    'Operation id from `GET /api/v2/blocks/{blockId}`. Required when the block exposes multiple operations; it may differ from the underlying tool id.',
    'not touched here: lives in v2/workflows.ts',
  ],
  [
    'Custom tool id returned by `GET /api/v2/custom-tools`.',
    'not touched here: lives in v2/workflows.ts',
  ],
  [
    'Deployment attempt accepted for processing. Activation is asynchronous, and `latestDeploymentAttempt` is the attempt handle — returned by every deployment mutation as well as this read. Poll activation with `isDeployed` and `deployedAt` on the workflow, or `isActive` on `GET /workflows/{workflowId}/versions`.',
    'not touched here: lives in v2/workflows.ts',
  ],
])

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

    const unexpected = [...offendingDescriptions(described)]
      .filter(([description]) => !ALLOWED.has(description))
      .map(([description, keys]) => `${keys[0]} :: ${description}`)

    expect(unexpected).toEqual([])
  })

  it('keeps the allowlist honest', async () => {
    const offending = offendingDescriptions(await sweepDescriptions())
    const stale = [...ALLOWED.keys()].filter((description) => !offending.has(description))

    expect(stale).toEqual([])
  })
})
