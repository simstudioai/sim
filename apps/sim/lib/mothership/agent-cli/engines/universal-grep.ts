import { isRecordLike } from '@sim/utils/object'
import { LRUCache } from 'lru-cache'
import type { ReadFileTextResponse } from 'sim/embed'
import { listCatalogTools } from '@/lib/catalog/application/list-tools'
import {
  type AgentCliEngine,
  type AgentCliFlags,
  type AgentCliRuntime,
  agentCliFail,
  agentCliOk,
} from '@/lib/mothership/agent-cli/types'
import { buildIntegrationToolSchemas } from '@/lib/mothership/chat/payload'

/**
 * `grep <pattern> [--scope a,b] [--in <world|id|name|world/id>] [-i] [-C n] [-A n] [-B n] [--count] [--limit n]` —
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
/** Past any catalog's size: the use case builds the full list in memory and slices it. */
const CATALOG_ALL = 100_000
const MAX_FILES = 300
const FILE_READ_CONCURRENCY = 5
const MAX_BYTES_PER_FILE = 262_144
/** `workflow:<uuid>` — a prefixed form no world or resource ever prints as its path. */
const PREFIX_SELECTOR = /^\w+:/
/**
 * Blocks and tools are platform-owned and change only on deploy, so their rendered
 * corpora are kept per workspace (visibility keys them). The tools world is the reason
 * this exists: 5,000 built-in tools list at 100 a page, so an unmemoized grep re-walked
 * the whole registry fifty times per call.
 */
const PLATFORM_SCOPES: ReadonlySet<Scope> = new Set<Scope>(['blocks', 'tools'])
const platformCache = new LRUCache<string, Materialized[]>({ max: 500, ttl: 60 * 60_000 })

/**
 * One build per (world, workspace) at a time. A turn that fans out several greps at once
 * used to build every world once per grep, concurrently — eight greps in one dev turn
 * meant 24 block-catalog listings, 150 tool-catalog pages, and 130 file reads inside
 * sixty seconds, on the one process serving the chat. Now the concurrent callers share
 * the build in flight.
 */
const inflight = new Map<string, Promise<Materialized[]>>()

/** A file's text keyed by id and version, so a repeat grep re-reads only files that changed. */
const fileTextCache = new LRUCache<string, { text: string | null }>({
  max: 5_000,
  ttl: 60 * 60_000,
})

/**
 * The requests behind a grep run in-process on the same server that answers the chat, so
 * the fan-out is bounded for the whole process, not per world: ten worlds at eight-way
 * concurrency each would be eighty nested route executions per grep.
 */
const NESTED_REQUEST_CONCURRENCY = 8
let activeRequests = 0
const waiting: Array<() => void> = []

async function gated<T>(work: () => Promise<T>): Promise<T> {
  if (activeRequests >= NESTED_REQUEST_CONCURRENCY) {
    await new Promise<void>((release) => waiting.push(release))
  }
  activeRequests += 1
  try {
    return await work()
  } finally {
    activeRequests -= 1
    waiting.shift()?.()
  }
}

function gatedRuntime(runtime: AgentCliRuntime): AgentCliRuntime {
  return {
    ...runtime,
    client: {
      request: (path, options) => gated(() => runtime.client.request(path, options)),
    },
  }
}

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

/**
 * The searchable text leads with the resource's own name and description: a workflow's
 * state carries neither, so `grep fx-` in an `fx-*` workspace found nothing.
 */
function render(scope: Scope, id: string, label: string, value: unknown): Materialized {
  const description =
    isRecordLike(value) && typeof (value as Record<string, unknown>).description === 'string'
      ? (value as Record<string, unknown>).description
      : ''
  const header = `name: ${label}${description ? `\ndescription: ${description}` : ''}\n`
  return { scope, id, label, text: `${header}${JSON.stringify(value, null, 2)}` }
}

interface IndexEntry {
  id: string
  /** Display identity: the resource's name when it has one, else its id. */
  label: string
  raw: unknown
}

function entry(id: string, label: string, raw: unknown): IndexEntry {
  return { id, label, raw }
}

function fileLabel(file: Record<string, unknown>): string {
  // `folderPath` is `/` at the root and `/Ops` below it; the match header already
  // supplies the `files/` prefix, so the label carries no slash of its own.
  const folder = (str(file.folderPath) ?? '').replace(/^\/+|\/+$/g, '')
  const name = str(file.name) ?? str(file.id) ?? ''
  return folder ? `${folder}/${name}` : name
}

/**
 * One cheap index per scope: the listing, which carries ids and names. A `--in` selector
 * resolves against these and fetches only what it names — materializing every world to
 * find one block cost 65 detail calls per `--in agent` (18-34s and the per-user rate
 * limit on dev, 2026-09-03).
 */
const INDEXERS: Record<Scope, (runtime: AgentCliRuntime) => Promise<IndexEntry[]>> = {
  workflows: async (runtime) =>
    (await listAll(runtime, '/api/v2/workflows')).map((w) =>
      entry(str(w.id) ?? '', str(w.name) ?? str(w.id) ?? '', w)
    ),
  blocks: async (runtime) =>
    (await listAll(runtime, '/api/v2/blocks')).map((b) =>
      entry(str(b.id) ?? '', str(b.id) ?? '', b)
    ),
  tools: async (runtime) => {
    // 5,000 built-in tools at the v2 page cap is fifty round trips through the route
    // stack, each re-resolving the gate and walking the registry — the whole cold cost of
    // a world-wide grep. With the caller's principal the catalog use case the route itself
    // runs answers in one call, same authorization, same projection.
    if (runtime.principal) {
      const page = await listCatalogTools.execute({
        principal: runtime.principal,
        input: {
          workspaceId: runtime.workspaceId,
          sortBy: 'id',
          sortOrder: 'asc',
          offset: 0,
          limit: CATALOG_ALL,
        },
      })
      return page.entries.map((t) => entry(t.id, t.id, t))
    }
    return (await listAll(runtime, '/api/v2/tools')).map((t) =>
      entry(str(t.id) ?? '', str(t.id) ?? '', t)
    )
  },
  tables: async (runtime) =>
    (await listAll(runtime, '/api/v2/tables')).map((t) =>
      entry(str(t.id) ?? '', str(t.name) ?? str(t.id) ?? '', t)
    ),
  files: async (runtime) =>
    (await listAll(runtime, '/api/v2/files'))
      .slice(0, MAX_FILES)
      .map((f) => entry(str(f.id) ?? '', fileLabel(f), f)),
  integrations: async (runtime) => {
    // The viewer's callable connected-service operations — the same projection the
    // chat request carries, so `integrations list` and this world never disagree.
    const tools = await buildIntegrationToolSchemas(
      runtime.userId,
      undefined,
      { schemaSurface: 'copilot' },
      runtime.workspaceId
    )
    return tools.map((tool) => entry(tool.name, tool.name, tool))
  },
  skills: async (runtime) =>
    (await listAll(runtime, '/api/v2/skills')).map((s) =>
      entry(str(s.id) ?? '', str(s.name) ?? str(s.id) ?? '', s)
    ),
  'custom-tools': async (runtime) =>
    (await listAll(runtime, '/api/v2/custom-tools')).map((t) =>
      entry(str(t.id) ?? '', str(t.title) ?? str(t.name) ?? str(t.id) ?? '', t)
    ),
  secrets: async (runtime) =>
    // Names only, by construction: a secret's value never enters the model window.
    (await listAll(runtime, '/api/v2/secrets')).map((s) =>
      entry(str(s.name) ?? '', str(s.name) ?? '', { name: s.name })
    ),
  credentials: async (runtime) =>
    (await listAll(runtime, '/api/v2/credentials')).map((c) =>
      entry(str(c.id) ?? '', str(c.name) ?? str(c.id) ?? '', {
        id: c.id,
        name: c.name,
        provider: c.provider ?? c.providerId,
        type: c.type,
      })
    ),
}

/** One fetch per scope: the resource as its `get` returns it, or null when unreadable. */
const FETCHERS: Record<
  Scope,
  (runtime: AgentCliRuntime, item: IndexEntry) => Promise<Materialized | null>
> = {
  workflows: async (runtime, item) => {
    // The draft state, not the export: export is sanitized for sharing and nulls
    // workspace-specific fields (a Table block's `tableId`), so a grep for a table id
    // inside a workflow would miss it. The state route scopes by workflow id alone
    // (`query: noInputSchema`); a workspaceId here is an "Unrecognized key".
    const state = await runtime.client.request<{ data: unknown }>(
      `/api/v2/workflows/${item.id}/state`
    )
    return render('workflows', item.id, item.label, state.data)
  },
  blocks: async (runtime, item) => {
    const detail = await runtime.client.request<{ data: unknown }>(`/api/v2/blocks/${item.id}`, {
      query: { workspaceId: runtime.workspaceId },
    })
    return render('blocks', item.id, item.label, detail.data)
  },
  tools: async (_runtime, item) => render('tools', item.id, item.label, item.raw),
  tables: async (runtime, item) => {
    const detail = await runtime.client.request<{ data: unknown }>(`/api/v2/tables/${item.id}`, {
      query: { workspaceId: runtime.workspaceId },
    })
    return render('tables', item.id, item.label, detail.data)
  },
  files: async (runtime, item) => {
    // File contents, through the v2 read-text endpoint (binary/degraded files are
    // honestly skipped there); the label is the path the model sees in `files ls`.
    const raw = isRecordLike(item.raw) ? (item.raw as Record<string, unknown>) : {}
    const version = `${item.id}:${str(raw.updatedAt) ?? ''}:${String(raw.size ?? '')}`
    let cached = fileTextCache.get(version)
    if (cached === undefined) {
      try {
        const response = await runtime.client.request<ReadFileTextResponse>(
          `/api/v2/files/${encodeURIComponent(item.id)}/text`,
          { query: { workspaceId: runtime.workspaceId, maxBytes: String(MAX_BYTES_PER_FILE) } }
        )
        cached = { text: response.data.degraded ? null : response.data.text }
      } catch {
        cached = { text: null }
      }
      fileTextCache.set(version, cached)
    }
    if (cached.text === null) return null
    return { scope: 'files', id: item.id, label: item.label, text: cached.text }
  },
  integrations: async (_runtime, item) => render('integrations', item.id, item.label, item.raw),
  skills: async (runtime, item) => {
    const detail = await runtime.client.request<{ data: unknown }>(`/api/v2/skills/${item.id}`, {
      query: { workspaceId: runtime.workspaceId },
    })
    return render('skills', item.id, item.label, detail.data)
  },
  'custom-tools': async (runtime, item) => {
    const detail = await runtime.client.request<{ data: unknown }>(
      `/api/v2/custom-tools/${item.id}`,
      { query: { workspaceId: runtime.workspaceId } }
    )
    return render('custom-tools', item.id, item.label, detail.data)
  },
  secrets: async (_runtime, item) => render('secrets', item.id, item.label, item.raw),
  credentials: async (_runtime, item) => render('credentials', item.id, item.label, item.raw),
}

function concurrencyFor(scope: Scope): number {
  return scope === 'files' ? FILE_READ_CONCURRENCY : FETCH_CONCURRENCY
}

async function fetchAll(
  runtime: AgentCliRuntime,
  scope: Scope,
  entries: IndexEntry[]
): Promise<Materialized[]> {
  const items = await mapConcurrent(entries, concurrencyFor(scope), (item) =>
    FETCHERS[scope](runtime, item)
  )
  return items.flatMap((m) => (m ? [m] : []))
}

/** A whole world, for a search with no `--in`: every resource the index lists. */
async function materializeScope(runtime: AgentCliRuntime, scope: Scope): Promise<Materialized[]> {
  const key = `${scope}:${runtime.workspaceId}`
  const platform = PLATFORM_SCOPES.has(scope)
  if (platform) {
    const cached = platformCache.get(key)
    if (cached !== undefined) return cached
  }
  const pending = inflight.get(key)
  if (pending) return pending
  const build = (async () => {
    const materialized = await fetchAll(runtime, scope, await INDEXERS[scope](runtime))
    if (platform) platformCache.set(key, materialized)
    return materialized
  })().finally(() => inflight.delete(key))
  inflight.set(key, build)
  return build
}

function selects(nameFilter: string): (id: string, label: string) => boolean {
  return (id, label) => id.toLowerCase() === nameFilter || label.toLowerCase().includes(nameFilter)
}

/**
 * Only the resources a `--in` selector names. Platform ids settle it first: `--in file_v5`
 * is a block id, both platform corpora are memoized, and an exact hit there means the
 * workspace worlds are never listed. A name fragment (`--in "lead scorer"`) has no such
 * anchor, so every searched world's index is read and only the matches are fetched.
 */
async function materializeWithin(
  runtime: AgentCliRuntime,
  scopes: Scope[],
  nameFilter: string
): Promise<Materialized[]> {
  // Cheapest platform world first: a block id answers from 65 definitions, and only a
  // miss there pays for the tool catalog's 5,000 entries.
  const platform: Materialized[] = []
  for (const scope of scopes.filter((scope) => PLATFORM_SCOPES.has(scope))) {
    const corpus = await materializeScope(runtime, scope)
    const exact = corpus.filter((m) => m.id.toLowerCase() === nameFilter)
    if (exact.length > 0) return exact
    platform.push(...corpus)
  }
  const wanted = selects(nameFilter)
  const perScope = await Promise.all(
    scopes.map(async (scope) => {
      if (PLATFORM_SCOPES.has(scope))
        return platform.filter((m) => m.scope === scope && wanted(m.id, m.label))
      const entries = (await INDEXERS[scope](runtime)).filter((e) => wanted(e.id, e.label))
      return fetchAll(runtime, scope, entries)
    })
  )
  return perScope.flat()
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

/** The `--in` forms a match line teaches: a world, a bare id or name, or world/resource. */
function unknownWithin(selector: string): string {
  return `Unknown --in selector ${JSON.stringify(selector)}. Pass a world (workflows, blocks, …), a resource's bare id or name, or world/resource as a match line prints it (e.g. blocks/table_v2).`
}

/**
 * Heads a model reaches for when it wants to grep a knowledge base. Knowledge is not a
 * grep world — chunks are retrieved semantically — so the refusal has to redirect rather
 * than just list the worlds, or the next attempt is the same selector spelled differently.
 */
const KNOWLEDGE_SELECTOR_HEADS = new Set(['knowledge', 'kb'])

function knowledgeWithin(selector: string): string {
  return `${unknownWithin(selector)} Knowledge bases are searched semantically — use knowledge search --kb <id> --query "…"; grep covers ${SCOPES.join(', ')}.`
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

interface ContextWindow {
  before: number
  after: number
}

function parseContextFlag(raw: unknown, flag: string): number | string | undefined {
  if (raw === undefined || raw === true) return undefined
  const n = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(n) || n < 0) return `-${flag} needs a non-negative number`
  return n
}

/**
 * `-C n` around each hit, `-B n` before, `-A n` after — the grep spelling the model
 * already knows. `-A`/`-B` used to be ignored silently, so `-A 40` returned the bare
 * match line and read as "context flags are non-deterministic".
 */
function parseContext(flags: AgentCliFlags): ContextWindow | string {
  const around = parseContextFlag(flags.C, 'C')
  if (typeof around === 'string') return around
  const before = parseContextFlag(flags.B, 'B')
  if (typeof before === 'string') return before
  const after = parseContextFlag(flags.A, 'A')
  if (typeof after === 'string') return after
  return { before: before ?? around ?? 0, after: after ?? around ?? 0 }
}

export const universalGrepCommand: AgentCliEngine = {
  async execute(positionals, runtime, flags) {
    const pattern = positionals[0]
    if (!pattern) {
      return agentCliFail(
        'Usage: sim grep <pattern> [--scope workflows,blocks,...] [--in <world|id|name|world/id>] [-i] [-C n] [-A n] [-B n] [--count] [--limit n]'
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
    // `--in tables` reads as "search the tables world", so a world name narrows the scope;
    // `--in blocks/table_v2` is the path a match line prints (world, then resource); a bare
    // value is a resource id or name inside the searched worlds.
    const within = typeof flags.in === 'string' ? flags.in : undefined
    const [withinHead, ...withinRest] = within ? within.toLowerCase().split('/') : []
    if (within && withinHead && KNOWLEDGE_SELECTOR_HEADS.has(withinHead)) {
      return agentCliFail(knowledgeWithin(within))
    }
    const withinScope = SCOPES.find((scope) => scope === withinHead)
    const withinResource = withinScope ? withinRest.join('/') : within?.toLowerCase()
    const searched: Scope[] = withinScope ? [withinScope] : scopes
    const nameFilter = withinResource || undefined
    /**
     * Refused before any fetch: the model learns the accepted forms without paying for
     * a full materialization it would only get an empty result from.
     */
    if (within && nameFilter && PREFIX_SELECTOR.test(nameFilter)) {
      return agentCliFail(unknownWithin(within))
    }
    const matches = compilePattern(pattern, ignoreCase)
    const bounded = gatedRuntime(runtime)
    const candidates = nameFilter
      ? await materializeWithin(bounded, searched, nameFilter)
      : (await Promise.all(searched.map((scope) => materializeScope(bounded, scope)))).flat()
    /**
     * A resource nothing in the searched worlds answers to is a wrong selector, not a
     * search with no hits — a silent "No matches" would hide the misspelling.
     */
    if (within && nameFilter && candidates.length === 0) {
      return agentCliFail(unknownWithin(within))
    }

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
        for (
          let j = Math.max(0, i - context.before);
          j <= Math.min(lines.length - 1, i + context.after);
          j++
        ) {
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
