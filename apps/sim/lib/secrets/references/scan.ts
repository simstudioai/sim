import { db } from '@sim/db'
import { customTools, mcpServers, workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { SubBlockRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import { ENV_REF_PATTERN, remapSubBlocks } from '@/ee/workspace-forking/lib/remap/remap-references'

const logger = createLogger('SecretReferenceScan')

/**
 * Cap on candidate blocks read in one scan. The prefilter matches the reference syntax itself,
 * so a candidate is already a genuine `{{name}}` occurrence and reaching this cap means the
 * workspace really does wire the key into thousands of blocks — at which point a complete list
 * is not the useful answer anyway. Reported back as {@link SecretReferenceScan.truncated}
 * rather than silently dropped.
 */
const BLOCK_SCAN_LIMIT = 2000

/** Matching cap for each cascade table, which are far smaller than the block table. */
const RESOURCE_SCAN_LIMIT = 200

/**
 * Ceiling on EMITTED resource entries, matching `secretReferenceResourceSchema`'s array bound in
 * the secrets contract. Capping rows alone is not enough: one MCP server yields an entry per
 * matching header plus one for its url, so 200 server rows can expand past the declared bound and
 * make the route reject its own response. The producer stops at the bound instead.
 */
const RESOURCE_EMIT_LIMIT = 400

/**
 * The env-key charset `ENV_REF_PATTERN` accepts. A name outside it can never appear inside
 * `{{ }}`, so the scan short-circuits — which also means the name is safe to inline into the
 * SQL regex below without escaping, since it cannot carry a metacharacter.
 */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface SecretReferenceBlock {
  blockId: string
  blockName: string
  blockType: string
  /**
   * A sub-block key on this block whose value carries the reference — not necessarily the
   * only one. The fork remapper collapses a block's references to one entry per
   * `(kind, sourceId)`, so a block naming the secret in two fields reports one of them. The
   * block is the unit the reader acts on; the field is there to locate it inside the block.
   */
  field: string
}

export interface SecretReferenceWorkflow {
  workflowId: string
  workflowName: string
  blocks: SecretReferenceBlock[]
}

/**
 * One reference site inside a resource a workflow reaches through rather than a block field.
 * An MCP server carrying the key in two headers yields two entries, so `id` alone is not
 * unique — `(kind, id, field)` is.
 */
export interface SecretReferenceResource {
  id: string
  kind: 'custom-tool' | 'mcp-server'
  name: string
  /** Where inside the resource the reference lives — `code`, `url`, or `header: X`. */
  field: string
}

export interface SecretReferenceScan {
  workflows: SecretReferenceWorkflow[]
  resources: SecretReferenceResource[]
  /** True when a scan cap was hit, so the lists are a prefix rather than the whole set. */
  truncated: boolean
}

interface ScanSecretReferencesParams {
  workspaceId: string
  name: string
}

/** Whether `text` carries a `{{name}}` reference, using the fork remapper's own pattern. */
function referencesEnvKey(text: string, name: string): boolean {
  for (const match of text.matchAll(ENV_REF_PATTERN)) {
    if (match[1] === name) return true
  }
  return false
}

/**
 * Matches the name sitting inside `{{ }}` with only non-word characters between, rather than the
 * bare name.
 *
 * Deliberately not `LIKE '%name%'`: `_` is a LIKE single-character wildcard and nearly every env
 * key contains one, so `SB_ACTION_ROUTER_SECRET` would match text it does not occur in. And
 * deliberately not a bare `strpos` either: that matched the name in prose and as a prefix of a
 * longer key (`API_KEY` inside `{{API_KEY_TEST}}`), and those false positives counted against the
 * row cap — so on a workspace with enough of them, genuine references sorted later were never
 * read at all.
 *
 * `[^[:alnum:]_]` rather than `[[:space:]]` because the two engines disagree about what
 * whitespace is: `ENV_REF_PATTERN`'s `\s` accepts U+00A0, U+202F, U+3000 and friends, while
 * Postgres `[[:space:]]` matches only the ASCII set — so a pasted non-breaking space inside the
 * braces is a reference the executor resolves and a whitespace-class prefilter would silently
 * drop. Excluding word characters instead accepts every whitespace encoding while still
 * rejecting a longer key on either side, and needs no code-point list that could drift.
 *
 * The looser class can admit a non-reference like `{{-NAME-}}`; that costs a candidate row and
 * nothing else, because the scanners below re-check every candidate and remain the authority.
 * Erring loose is deliberate — a false positive is a wasted read, a false negative is this
 * feature telling someone a live key is unused.
 */
function referencesKey(column: unknown, envKey: string) {
  return sql`${column} ~ ${`\\{\\{[^[:alnum:]_]*${envKey}[^[:alnum:]_]*\\}\\}`}`
}

/**
 * Every place in a workspace that names one secret: the blocks that reference it as
 * `{{KEY}}`, plus the custom tools and MCP servers whose own bodies carry it.
 *
 * Detection is the workspace-fork remapper's — {@link remapSubBlocks} already walks nested
 * `tool-input` params, resolves canonical basic/advanced pairs, and skips dormant and
 * condition-hidden members. Only the aggregation is new: `scanWorkflowReferences` collapses
 * its output to unique `(kind, sourceId)` pairs, which is right for building a mapping table
 * and wrong for answering "where is this wired in".
 *
 * The scan is name-based and therefore identical for a workspace and a personal secret — a
 * `{{KEY}}` in a workflow names a key, not a scope, and resolves to whichever slice wins at
 * run time. The detail page already reports shadowing separately.
 */
export async function scanSecretReferences({
  workspaceId,
  name,
}: ScanSecretReferencesParams): Promise<SecretReferenceScan> {
  // A name outside the env-key charset cannot appear inside `{{ }}`, so nothing can reference it.
  if (!ENV_KEY_PATTERN.test(name)) return { workflows: [], resources: [], truncated: false }

  const [blocks, tools, servers] = await Promise.all([
    db
      .select({
        blockId: workflowBlocks.id,
        blockName: workflowBlocks.name,
        blockType: workflowBlocks.type,
        subBlocks: workflowBlocks.subBlocks,
        data: workflowBlocks.data,
        workflowId: workflow.id,
        workflowName: workflow.name,
      })
      .from(workflowBlocks)
      .innerJoin(workflow, eq(workflow.id, workflowBlocks.workflowId))
      .where(
        and(
          eq(workflow.workspaceId, workspaceId),
          isNull(workflow.archivedAt),
          referencesKey(sql`${workflowBlocks.subBlocks}::text`, name)
        )
      )
      .orderBy(asc(workflow.name), asc(workflow.id), asc(workflowBlocks.name))
      .limit(BLOCK_SCAN_LIMIT + 1),
    db
      .select({ id: customTools.id, title: customTools.title, code: customTools.code })
      .from(customTools)
      .where(and(eq(customTools.workspaceId, workspaceId), referencesKey(customTools.code, name)))
      .orderBy(asc(customTools.title))
      .limit(RESOURCE_SCAN_LIMIT + 1),
    db
      .select({
        id: mcpServers.id,
        name: mcpServers.name,
        url: mcpServers.url,
        headers: mcpServers.headers,
      })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.workspaceId, workspaceId),
          isNull(mcpServers.deletedAt),
          // `headers` is a `json` column, so `::text` is the only safe read here — a jsonb
          // operator would raise 42883 and abort the statement.
          sql`(${referencesKey(mcpServers.url, name)} OR ${referencesKey(sql`${mcpServers.headers}::text`, name)})`
        )
      )
      .orderBy(asc(mcpServers.name))
      .limit(RESOURCE_SCAN_LIMIT + 1),
  ])

  let truncated =
    blocks.length > BLOCK_SCAN_LIMIT ||
    tools.length > RESOURCE_SCAN_LIMIT ||
    servers.length > RESOURCE_SCAN_LIMIT

  const workflows: SecretReferenceWorkflow[] = []
  const workflowIndex = new Map<string, SecretReferenceWorkflow>()

  for (const row of blocks.slice(0, BLOCK_SCAN_LIMIT)) {
    let field: string | undefined
    try {
      const { references } = remapSubBlocks(row.subBlocks as SubBlockRecord, () => null, {
        blockId: row.blockId,
        blockName: row.blockName,
        blockType: row.blockType,
        canonicalModes: (row.data as { canonicalModes?: CanonicalModeOverrides } | null)
          ?.canonicalModes,
      })
      field = references.find(
        (reference) => reference.kind === 'env-var' && reference.sourceId === name
      )?.subBlockKey
    } catch (error) {
      // One malformed block must not blank the whole tab. The block is dropped rather than
      // reported without the field that carries the reference, which would read as a
      // reference we cannot locate — and the log names it so the shape can be fixed.
      logger.error('Failed to scan block for secret references', {
        blockId: row.blockId,
        workflowId: row.workflowId,
        error,
      })
      continue
    }
    if (!field) continue

    let entry = workflowIndex.get(row.workflowId)
    if (!entry) {
      entry = { workflowId: row.workflowId, workflowName: row.workflowName, blocks: [] }
      workflowIndex.set(row.workflowId, entry)
      workflows.push(entry)
    }
    entry.blocks.push({
      blockId: row.blockId,
      blockName: row.blockName,
      blockType: row.blockType,
      field,
    })
  }

  const resources: SecretReferenceResource[] = []

  /**
   * Stops at {@link RESOURCE_EMIT_LIMIT} rather than trusting the row caps to bound the output.
   * One server expands to an entry per matching header, so the emitted total is what has to be
   * checked against the contract's array bound — exceeding it would make the route reject its
   * own response and turn a successful scan into a 500.
   */
  const emitResource = (resource: SecretReferenceResource): boolean => {
    if (resources.length >= RESOURCE_EMIT_LIMIT) {
      truncated = true
      return false
    }
    resources.push(resource)
    return true
  }

  for (const tool of tools.slice(0, RESOURCE_SCAN_LIMIT)) {
    if (!referencesEnvKey(tool.code ?? '', name)) continue
    if (!emitResource({ id: tool.id, kind: 'custom-tool', name: tool.title, field: 'code' })) break
  }

  for (const server of servers.slice(0, RESOURCE_SCAN_LIMIT)) {
    if (resources.length >= RESOURCE_EMIT_LIMIT) {
      truncated = true
      break
    }
    if (server.url && referencesEnvKey(server.url, name)) {
      emitResource({ id: server.id, kind: 'mcp-server', name: server.name, field: 'url' })
    }
    const headers = (server.headers ?? {}) as Record<string, unknown>
    for (const [headerName, headerValue] of Object.entries(headers)) {
      if (typeof headerValue !== 'string') continue
      if (!referencesEnvKey(headerValue, name)) continue
      const emitted = emitResource({
        id: server.id,
        kind: 'mcp-server',
        name: server.name,
        field: `header: ${headerName}`,
      })
      if (!emitted) break
    }
  }

  return { workflows, resources, truncated }
}
