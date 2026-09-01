import { db } from '@sim/db'
import { customTools, mcpServers, workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { SubBlockRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import { isSyntheticToolSubBlockId } from '@/lib/workflows/tool-input/synthetic-subblocks'
import { ENV_REF_PATTERN, remapSubBlocks } from '@/ee/workspace-forking/lib/remap/remap-references'

const logger = createLogger('SecretReferenceScan')

/**
 * Cap on blocks REPORTED — confirmed references, not rows read.
 *
 * Capping candidates instead made the answer depend on how many irrelevant rows happened to sort
 * first. The prefilter can only judge syntax, while `remapSubBlocks` additionally drops dormant
 * canonical members and condition-hidden fields — semantics no SQL predicate can replicate — so a
 * block whose only `{{name}}` sits in a hidden field is a real candidate that yields nothing, and
 * enough of them sorted earlier displaced active references out of the result.
 */
const BLOCK_RESULT_LIMIT = 2000

/**
 * Ceiling on candidate rows read, so a scan cannot walk an unbounded set.
 *
 * Sits above {@link BLOCK_RESULT_LIMIT} so semantically filtered rows — dormant members and
 * condition-hidden fields, which the SQL cannot judge — are absorbed as extra reads rather than
 * displacing results. The headroom is deliberately modest: every candidate carries its block's
 * `sub_blocks`, so this is the memory bound as much as the work bound.
 *
 * It is also the irreducible one. Bounded work and guaranteed completeness cannot both hold, so
 * the only real choices are where the bound sits and whether it counts something the reader can
 * see. It counts results.
 */
const BLOCK_CANDIDATE_CEILING = 4000

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

/**
 * Drops the `{subBlockId}-tool-{index}-{paramId}` mirrors a tool row renders with.
 *
 * Those ids are documented as an ephemeral, client-only projection of the value held canonically
 * at `tool.params[paramId]` inside the aggregate `tool-input` sub-block — they are not supposed
 * to be persisted at all, but rows predating that rule still carry them. Left in, the scanner
 * reports whichever the record happens to yield last, which surfaced an internal key like
 * `tools-tool-0-code` where the reader expects a field.
 *
 * Removing them is right even when the two disagree: the canonical `tool.params` is what
 * executes, so a mirror the canonical no longer matches describes a reference that no longer
 * runs.
 */
function withoutToolMirrors(subBlocks: SubBlockRecord): SubBlockRecord {
  const canonical: SubBlockRecord = {}
  for (const [key, value] of Object.entries(subBlocks)) {
    if (isSyntheticToolSubBlockId(key)) continue
    canonical[key] = value
  }
  return canonical
}

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
 * Code points JS `\s` matches beyond ASCII, as inclusive ranges. Spelled out as numbers and
 * rendered to `\uXXXX` below rather than written literally, so the source stays readable ASCII
 * instead of carrying a run of invisible characters no reviewer could check.
 */
const UNICODE_SPACE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
]

/** A code point as the `\uXXXX` escape a Postgres regex understands. */
function toPgEscape(codePoint: number): string {
  return `\\u${codePoint.toString(16).padStart(4, '0')}`
}

const UNICODE_SPACE_CLASS = UNICODE_SPACE_RANGES.map(([low, high]) =>
  low === high ? toPgEscape(low) : `${toPgEscape(low)}-${toPgEscape(high)}`
).join('')

/**
 * One unit of what may sit between `{{` and the name: exactly the whitespace
 * `ENV_REF_PATTERN` accepts, in each encoding it can arrive in.
 *
 * The prefilter reads a `::text` rendering of a JSON column, and the two regex engines
 * disagree about whitespace, so all three forms are spelled out: `[[:space:]]` for raw ASCII;
 * the JSON escapes, since `jsonb::text` renders a real tab as the literal pair `\\` `t` and a
 * vertical tab as `\\u000b`; and the Unicode class above, which Postgres emits verbatim and
 * `[[:space:]]` does not match though JS `\\s` does.
 *
 * Enumerating whitespace rather than excluding word characters costs a list to keep in step
 * with `\\s`, and buys a prefilter exactly as tight as the authority. A looser gap admitted
 * `{{-NAME-}}` and `{{"NAME"}}`, and those are not free: each occupies a row under
 * {@link BLOCK_SCAN_LIMIT}, so a workspace with enough of them sorted earlier would exhaust
 * the cap before a genuine reference was read — reporting a live key as unused.
 */
const REFERENCE_GAP = `([[:space:]]|\\\\[tnrf]|\\\\u000[bB]|[${UNICODE_SPACE_CLASS}])`

/**
 * Matches the name sitting inside `{{ }}` with only {@link REFERENCE_GAP} units between.
 *
 * Deliberately not `LIKE '%name%'`: `_` is a LIKE single-character wildcard and nearly every env
 * key contains one, so `SB_ACTION_ROUTER_SECRET` would match text it does not occur in. And
 * deliberately not a bare `strpos` either: that matched the name in prose and as a prefix of a
 * longer key (`API_KEY` inside `{{API_KEY_TEST}}`), and those false positives counted against the
 * row cap — so on a workspace with enough of them, genuine references sorted later were never
 * read at all.
 *
 * The gap accepts exactly the whitespace `ENV_REF_PATTERN` does, so a candidate row is always a
 * real occurrence and the cap counts only references. The scanners below still re-check each one
 * and remain the authority; this decides what is worth reading.
 */
function referencesKey(column: unknown, envKey: string) {
  return sql`${column} ~ ${`\\{\\{${REFERENCE_GAP}*${envKey}${REFERENCE_GAP}*\\}\\}`}`
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

  /**
   * All candidates in one read, up to the ceiling.
   *
   * Deliberately not paged. Paging bought headroom but paid for it with drift: `OFFSET` is
   * positional, so a block renamed, inserted or deleted between pages shifts the result set and
   * the scan silently skips a live reference or reports one twice. One statement is one snapshot,
   * so neither can happen — and the ceiling is what bounds the read instead.
   *
   * `blockId` still closes the ordering, so repeated scans of an unchanged workspace return the
   * same list in the same order rather than an arbitrary one among ties.
   */
  const readCandidates = () =>
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
      .orderBy(
        asc(workflow.name),
        asc(workflow.id),
        asc(workflowBlocks.name),
        asc(workflowBlocks.id)
      )
      // Limit-plus-one, like the resource reads: the extra row is how "there were more" is known
      // without claiming truncation on a set that ended exactly on the bound.
      .limit(BLOCK_CANDIDATE_CEILING + 1)

  const [candidates, tools, servers] = await Promise.all([
    readCandidates(),
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

  /** Every bound is `> limit` on a limit-plus-one read, so landing exactly on one is not truncation. */
  let truncated =
    tools.length > RESOURCE_SCAN_LIMIT ||
    servers.length > RESOURCE_SCAN_LIMIT ||
    candidates.length > BLOCK_CANDIDATE_CEILING

  const workflows: SecretReferenceWorkflow[] = []
  const workflowIndex = new Map<string, SecretReferenceWorkflow>()
  let reported = 0

  for (const row of candidates.slice(0, BLOCK_CANDIDATE_CEILING)) {
    /* Reporting stops at the result limit, but the read does not: the remaining candidates are
       still worth walking only insofar as they cannot add results, so stop here and say so. */
    if (reported >= BLOCK_RESULT_LIMIT) {
      truncated = true
      break
    }
    scanCandidate(row)
  }

  function scanCandidate(row: {
    blockId: string
    blockName: string
    blockType: string
    subBlocks: unknown
    data: unknown
    workflowId: string
    workflowName: string
  }): void {
    let field: string | undefined
    try {
      const { references } = remapSubBlocks(
        withoutToolMirrors(row.subBlocks as SubBlockRecord),
        () => null,
        {
          blockId: row.blockId,
          blockName: row.blockName,
          blockType: row.blockType,
          canonicalModes: (row.data as { canonicalModes?: CanonicalModeOverrides } | null)
            ?.canonicalModes,
        }
      )
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
      return
    }
    if (!field) return

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
    reported += 1
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
