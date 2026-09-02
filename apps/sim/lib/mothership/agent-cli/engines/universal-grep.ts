import { LRUCache } from 'lru-cache'
import type { ReadFileTextResponse } from 'sim/embed'
import {
  type AgentCliEngine,
  type AgentCliFlags,
  type AgentCliRuntime,
  agentCliFail,
  agentCliOk,
} from '@/lib/mothership/agent-cli/types'
import { buildIntegrationToolSchemas } from '@/lib/mothership/chat/payload'

/**
 * `grep <pattern> [--scope a,b] [--in <id|name>] [-i] [-C n] [--count] [--limit n]` —
 * ONE search over the materialized text of every world the agent can see (18-agent-
 * surface.md A2). Each resource is rendered to pretty-printed JSON exactly as its
 * `get` command returns it, so a hit names the same path the model would read next:
 *   blocks/slack_v2.triggers[0].configFields.streamOutputs: {...}
 *
 * The VFS grep, with the corpus back — including component definitions, which no
 * list `--search` can see into. Knowledge stays with its semantic `knowledge search`.
 */

const SCOPES = [
  'workflows',
  'blocks',
  'tools',
  'tables',
  'files',
  'integrations',
  'skills',
  'custom-tools',
  'secrets',
  'credentials',
] as const
type Scope = (typeof SCOPES)[number]

const DEFAULT_MATCH_LIMIT = 100
const MAX_MATCH_LIMIT = 500
const MAX_LINE_CHARS = 2_000
const FETCH_CONCURRENCY = 8
const MAX_FILES = 300
const FILE_READ_CONCURRENCY = 5
const MAX_BYTES_PER_FILE = 262_144
/** The block catalog is platform-owned and changes only on deploy; per-workspace visibility keys it. */
const catalogCache = new LRUCache<string, Materialized[]>({ max: 500, ttl: 10 * 60_000 })

interface Materialized {
  scope: Scope
  /** Display identity: the resource's name when it has one, else its id. */
  label: string
  id: string
  text: string
}

interface Page {
  data: Record<string, unknown>[]
  nextCursor?: string | null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

async function listAll(runtime: AgentCliRuntime, path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let cursor: string | undefined
  for (let pages = 0; pages < 50; pages++) {
    const page = await runtime.client.request<Page>(path, {
      query: { workspaceId: runtime.workspaceId, limit: '100', ...(cursor ? { cursor } : {}) },
    })
    out.push(...page.data)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  return out
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await fn(items[index])
      }
    })
  )
  return results
}

function render(scope: Scope, id: string, label: string, value: unknown): Materialized {
  return { scope, id, label, text: JSON.stringify(value, null, 2) }
}

/** One materializer per scope: the list, then each resource as its `get` returns it. */
const MATERIALIZERS: Record<Scope, (runtime: AgentCliRuntime) => Promise<Materialized[]>> = {
  workflows: async (runtime) => {
    const list = await listAll(runtime, '/api/v2/workflows')
    return mapConcurrent(list, FETCH_CONCURRENCY, async (w) => {
      const id = str(w.id) ?? ''
      // The export route scopes by workflow id alone (`query: noInputSchema`); a
      // workspaceId here is an "Unrecognized key" — the other detail routes require it.
      const exported = await runtime.client.request<{ data: { state: unknown } }>(
        `/api/v2/workflows/${id}/export`
      )
      return render('workflows', id, str(w.name) ?? id, exported.data.state)
    })
  },
  blocks: async (runtime) => {
    const key = runtime.workspaceId
    const cached = catalogCache.get(key)
    if (cached !== undefined) return cached
    const list = await listAll(runtime, '/api/v2/blocks')
    const materialized = await mapConcurrent(list, FETCH_CONCURRENCY, async (b) => {
      const id = str(b.id) ?? ''
      const detail = await runtime.client.request<{ data: unknown }>(`/api/v2/blocks/${id}`, {
        query: { workspaceId: runtime.workspaceId },
      })
      return render('blocks', id, id, detail.data)
    })
    catalogCache.set(key, materialized)
    return materialized
  },
  tools: async (runtime) => {
    const list = await listAll(runtime, '/api/v2/tools')
    return list.map((t) => render('tools', str(t.id) ?? '', str(t.id) ?? '', t))
  },
  tables: async (runtime) => {
    const list = await listAll(runtime, '/api/v2/tables')
    return mapConcurrent(list, FETCH_CONCURRENCY, async (t) => {
      const id = str(t.id) ?? ''
      const detail = await runtime.client.request<{ data: unknown }>(`/api/v2/tables/${id}`, {
        query: { workspaceId: runtime.workspaceId },
      })
      return render('tables', id, str(t.name) ?? id, detail.data)
    })
  },
  skills: async (runtime) => {
    const list = await listAll(runtime, '/api/v2/skills')
    return mapConcurrent(list, FETCH_CONCURRENCY, async (s) => {
      const id = str(s.id) ?? ''
      const detail = await runtime.client.request<{ data: unknown }>(`/api/v2/skills/${id}`, {
        query: { workspaceId: runtime.workspaceId },
      })
      return render('skills', id, str(s.name) ?? id, detail.data)
    })
  },
  'custom-tools': async (runtime) => {
    const list = await listAll(runtime, '/api/v2/custom-tools')
    return mapConcurrent(list, FETCH_CONCURRENCY, async (t) => {
      const id = str(t.id) ?? ''
      const detail = await runtime.client.request<{ data: unknown }>(`/api/v2/custom-tools/${id}`, {
        query: { workspaceId: runtime.workspaceId },
      })
      return render('custom-tools', id, str(t.title) ?? str(t.name) ?? id, detail.data)
    })
  },
  files: async (runtime) => {
    // File contents, through the v2 read-text endpoint (binary/degraded files are
    // honestly skipped there); the label is the path the model sees in `files ls`.
    const list = (await listAll(runtime, '/api/v2/files')).slice(0, MAX_FILES)
    const texts = await mapConcurrent(list, FILE_READ_CONCURRENCY, async (file) => {
      const id = str(file.id) ?? ''
      try {
        const response = await runtime.client.request<ReadFileTextResponse>(
          `/api/v2/files/${encodeURIComponent(id)}/text`,
          { query: { workspaceId: runtime.workspaceId, maxBytes: String(MAX_BYTES_PER_FILE) } }
        )
        return { file, text: response.data.degraded ? null : response.data.text }
      } catch {
        return { file, text: null }
      }
    })
    return texts.flatMap(({ file, text }) => {
      if (text === null) return []
      const folder = (str(file.folderPath) ?? '').replace(/\/+$/, '')
      const name = str(file.name) ?? str(file.id) ?? ''
      const label = folder ? `${folder}/${name}` : `/${name}`
      return [{ scope: 'files' as const, id: str(file.id) ?? '', label, text }]
    })
  },
  integrations: async (runtime) => {
    // The viewer's callable connected-service operations — the same projection the
    // chat request carries, so `integrations list` and this world never disagree.
    const tools = await buildIntegrationToolSchemas(
      runtime.userId,
      undefined,
      { schemaSurface: 'copilot' },
      runtime.workspaceId
    )
    return tools.map((tool) => render('integrations', tool.name, tool.name, tool))
  },
  secrets: async (runtime) => {
    // Names only, by construction: a secret's value never enters the model window.
    const list = await listAll(runtime, '/api/v2/secrets')
    return list.map((s) =>
      render('secrets', str(s.name) ?? '', str(s.name) ?? '', { name: s.name })
    )
  },
  credentials: async (runtime) => {
    const list = await listAll(runtime, '/api/v2/credentials')
    return list.map((c) =>
      render('credentials', str(c.id) ?? '', str(c.name) ?? str(c.id) ?? '', {
        id: c.id,
        name: c.name,
        provider: c.provider ?? c.providerId,
        type: c.type,
      })
    )
  },
}

function compilePattern(raw: string, ignoreCase: boolean): (line: string) => boolean {
  try {
    const regex = new RegExp(raw, ignoreCase ? 'i' : '')
    return (line) => regex.test(line)
  } catch {
    const needle = ignoreCase ? raw.toLowerCase() : raw
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle)
  }
}

function clip(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}… [line truncated]` : line
}

function didYouMean(scope: string): string {
  const close = SCOPES.filter((s) => s.startsWith(scope.slice(0, 2)))
  return close.length > 0 ? ` Did you mean ${close.join(' or ')}?` : ''
}

function parseScopes(flags: AgentCliFlags): Scope[] | string {
  const raw = flags.scope
  if (raw === undefined || raw === true) return [...SCOPES]
  const scopes: Scope[] = []
  for (const part of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (!(SCOPES as readonly string[]).includes(part)) {
      return `Unknown scope "${part}".${didYouMean(part)} Scopes: ${SCOPES.join(', ')}.`
    }
    scopes.push(part as Scope)
  }
  return scopes
}

function parseLimit(flags: AgentCliFlags): number | string {
  const raw = flags.limit
  if (raw === undefined || raw === true) return DEFAULT_MATCH_LIMIT
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return '--limit needs a positive number'
  return Math.min(n, MAX_MATCH_LIMIT)
}

function parseContext(flags: AgentCliFlags): number | string {
  const raw = flags.C
  if (raw === undefined || raw === true) return 0
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return '-C needs a non-negative number'
  return n
}

export const universalGrepCommand: AgentCliEngine = {
  async execute(positionals, runtime, flags) {
    const pattern = positionals[0]
    if (!pattern) {
      return agentCliFail(
        'Usage: sim grep <pattern> [--scope workflows,blocks,...] [--in <id|name>] [-i] [-C n] [--count] [--limit n]'
      )
    }
    const scopes = parseScopes(flags)
    if (typeof scopes === 'string') return agentCliFail(scopes)
    const limit = parseLimit(flags)
    if (typeof limit === 'string') return agentCliFail(limit)
    const context = parseContext(flags)
    if (typeof context === 'string') return agentCliFail(context)
    const ignoreCase = flags.i === true
    const countOnly = flags.count === true
    const within = typeof flags.in === 'string' ? flags.in.toLowerCase() : undefined
    // `--in tables` reads as "search the tables world", so a world name narrows the scope;
    // anything else is a resource id or name inside the searched worlds.
    const withinScope = SCOPES.find((scope) => scope === within)
    const searched: Scope[] = withinScope ? [withinScope] : scopes
    const nameFilter = withinScope ? undefined : within
    const matches = compilePattern(pattern, ignoreCase)

    const materialized = (
      await Promise.all(searched.map((scope) => MATERIALIZERS[scope](runtime)))
    ).flat()
    const candidates = nameFilter
      ? materialized.filter(
          (m) => m.id.toLowerCase() === nameFilter || m.label.toLowerCase().includes(nameFilter)
        )
      : materialized

    const out: string[] = []
    let total = 0
    const perScope = new Map<Scope, number>()
    for (const resource of candidates) {
      const lines = resource.text.split('\n')
      const selected = new Set<number>()
      for (let i = 0; i < lines.length; i++) {
        if (!matches(lines[i])) continue
        total++
        perScope.set(resource.scope, (perScope.get(resource.scope) ?? 0) + 1)
        if (countOnly) continue
        for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
          selected.add(j)
        }
      }
      if (countOnly || selected.size === 0) continue
      const header = `${resource.scope}/${resource.label}${resource.label === resource.id ? '' : ` (${resource.id})`}`
      for (const i of [...selected].sort((a, b) => a - b)) {
        if (out.length >= limit) break
        out.push(`${header}:${i + 1}: ${clip(lines[i])}`)
      }
      if (out.length >= limit) break
    }

    if (countOnly) {
      const breakdown = [...perScope.entries()].map(([s, n]) => `${s}=${n}`).join(' ')
      return agentCliOk(`${total}${breakdown ? ` (${breakdown})` : ''}`)
    }
    if (out.length === 0) {
      return agentCliOk(
        `No matches for ${JSON.stringify(pattern)} in ${searched.join(', ')}${nameFilter ? ` within "${nameFilter}"` : ''}.`
      )
    }
    const truncated =
      total > out.length
        ? `\n[${out.length} of ${total} matching lines shown — narrow with --scope, --in, or a tighter pattern]`
        : ''
    return agentCliOk(out.join('\n') + truncated)
  },
}
