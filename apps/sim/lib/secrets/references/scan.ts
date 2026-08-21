import { db } from '@sim/db'
import { customTools, mcpServers, workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { SubBlockRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import { ENV_REF_PATTERN, remapSubBlocks } from '@/ee/workspace-forking/lib/remap/remap-references'

const logger = createLogger('SecretReferenceScan')

/**
 * Cap on candidate blocks read in one scan. The prefilter already narrows to blocks whose stored
 * JSON contains the name, so reaching this means a workspace genuinely wires the key into
 * thousands of places — at which point a complete list is not the useful answer anyway. Reported
 * back as {@link SecretReferenceScan.truncated} rather than silently dropped.
 */
const BLOCK_SCAN_LIMIT = 2000

/** Matching cap for each cascade table, which are far smaller than the block table. */
const RESOURCE_SCAN_LIMIT = 200

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
 * `strpos(haystack, needle) > 0` — a literal substring test.
 *
 * Deliberately not `LIKE '%name%'`: `_` is a LIKE single-character wildcard and every other
 * env key contains one, so `SB_ACTION_ROUTER_SECRET` would match text it does not occur in.
 * The prefilter may over-match (a bare name outside `{{ }}`, or a name that is a prefix of a
 * different key) but can never under-match, because a real reference always contains the
 * literal name. The scanners below re-check every candidate and are the authority.
 */
function containsLiteral(column: unknown, needle: string) {
  return sql`strpos(${column}, ${needle}) > 0`
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
          containsLiteral(sql`${workflowBlocks.subBlocks}::text`, name)
        )
      )
      .orderBy(asc(workflow.name), asc(workflow.id), asc(workflowBlocks.name))
      .limit(BLOCK_SCAN_LIMIT + 1),
    db
      .select({ id: customTools.id, title: customTools.title, code: customTools.code })
      .from(customTools)
      .where(and(eq(customTools.workspaceId, workspaceId), containsLiteral(customTools.code, name)))
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
          sql`(${containsLiteral(mcpServers.url, name)} OR ${containsLiteral(sql`${mcpServers.headers}::text`, name)})`
        )
      )
      .orderBy(asc(mcpServers.name))
      .limit(RESOURCE_SCAN_LIMIT + 1),
  ])

  const truncated =
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

  for (const tool of tools.slice(0, RESOURCE_SCAN_LIMIT)) {
    if (!referencesEnvKey(tool.code ?? '', name)) continue
    resources.push({ id: tool.id, kind: 'custom-tool', name: tool.title, field: 'code' })
  }

  for (const server of servers.slice(0, RESOURCE_SCAN_LIMIT)) {
    if (server.url && referencesEnvKey(server.url, name)) {
      resources.push({ id: server.id, kind: 'mcp-server', name: server.name, field: 'url' })
    }
    const headers = (server.headers ?? {}) as Record<string, unknown>
    for (const [headerName, headerValue] of Object.entries(headers)) {
      if (typeof headerValue !== 'string') continue
      if (!referencesEnvKey(headerValue, name)) continue
      resources.push({
        id: server.id,
        kind: 'mcp-server',
        name: server.name,
        field: `header: ${headerName}`,
      })
    }
  }

  return { workflows, resources, truncated }
}
