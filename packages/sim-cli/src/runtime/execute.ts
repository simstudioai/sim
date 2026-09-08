import type { Command } from 'commander'
import { clientFrom } from '../context'
import type { CommandSpec } from '../contract/types'
import type { V2OperationName } from '../generated/v2-api'
import { pageProgress, SimApiError, type V2Page } from '../http/client'
import { safeOneLine } from '../output/render'
import { camel } from './derive'
import { DEFAULT_LIMIT } from './options'
import { warnRenamedFlag } from './renamed'
import {
  buildRequest,
  cursorSlot,
  flagNameFor,
  isProfileWorkspacePath,
  PROFILE_INJECTED_FIELD,
} from './request'
import { foldPageEnvelope, renderPage, renderResult } from './result'
import type { OperationSpec } from './types'

/**
 * Operations that report the outcome of the work they did in band.
 *
 * The execute route answers `200` with `status: 'failed'` and a structured
 * `error` rather than an HTTP error, so a failed run left the terminal
 * indistinguishable from a successful one: `sim workflows run` printed the
 * failure and still exited `0`, and a CI step gated on it stayed green.
 * `--follow` and `runs wait` already fail the process on the same outcome; this
 * is the plain run path catching up with them.
 *
 * Named per operation on purpose. A `status` field is common across unrelated
 * v2 payloads — job records, import receipts, connector syncs — and taking any
 * `status: 'failed'` as the command's own outcome would start failing commands
 * that merely *report* somebody else's failed record.
 */
const RUN_OUTCOME_OPERATIONS: Readonly<
  Partial<Record<V2OperationName, Readonly<Record<string, string>>>>
> = {
  /**
   * Terminal run statuses that are not a success, and how each is explained.
   *
   * `paused` is deliberately absent: a run held at a human-in-the-loop pause has
   * not failed and can still be resumed, and `--follow` reports it the same way
   * it reports a success.
   */
  executeWorkflow: {
    failed: 'The workflow run failed.',
    cancelled: 'The workflow run was cancelled.',
  },
  /**
   * A tool that ran and refused answers `200` for the same reason a failed run
   * does — the API call worked, the third party did not — so the exit code is
   * the only thing left to carry the outcome. The fallback is per operation
   * because "the workflow run failed" is not what happened here; in practice
   * the tool's own error message wins, and this only speaks when it is absent.
   */
  executeTool: {
    failed: 'The tool call failed.',
  },
}

/** The one-line explanation of an in-band run failure, or `null` if there is none. */
export function runFailureMessage(operation: V2OperationName, payload: unknown): string | null {
  const failureMessages = RUN_OUTCOME_OPERATIONS[operation]
  if (!failureMessages) return null
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null

  const { status, error } = payload as { status?: unknown; error?: unknown }
  if (typeof status !== 'string') return null
  const fallback = failureMessages[status]
  if (!fallback) return null

  const reported = (error as { message?: unknown } | null | undefined)?.message
  return safeOneLine(typeof reported === 'string' && reported ? reported : fallback)
}

/**
 * Bulk operations that answer `200` even when they changed nothing.
 *
 * These endpoints are deliberately best-effort: they attempt every item, then
 * report per-item outcomes in the payload. That is right for a partial
 * success — some items really were deleted or moved — but a call that touched
 * nothing at all is a failure the caller has to notice, and exiting `0` left
 * `sim tables batch-delete --table-ids '["tbl_typo"]'` indistinguishable from a
 * real deletion in a CI step.
 *
 * Only a total miss fails. A partial success still exits `0`: the payload names
 * every item that did not make it, and failing the process there would break
 * every caller that legitimately sweeps a list containing already-gone items.
 */
/**
 * Reads a bulk payload, and the request that produced it, for a total miss.
 *
 * The request is needed because not every bulk response reports the items it
 * failed on: `bulkDeleteFiles` answers with a deleted count and nothing else,
 * so the only place the number of items asked for exists is the body that was
 * sent.
 */
type BulkOutcomeCheck = (
  payload: Record<string, unknown>,
  body: Record<string, unknown> | undefined
) => string | null

export const BULK_OUTCOME_CHECKS: Readonly<Partial<Record<V2OperationName, BulkOutcomeCheck>>> = {
  bulkDeleteFiles: (payload, body) => {
    if (countOf((payload.deletedItems as { files?: unknown } | undefined)?.files) > 0) return null
    const requested = lengthOf(body?.fileIds)
    if (requested === 0) return null
    return `Deleted nothing: none of the ${requested} requested ${requested === 1 ? 'file was' : 'files were'} deleted.`
  },
  /**
   * `added` empty with `failed` populated is a call that indexed nothing. An
   * empty request — no file resolved to a reference at all — is not a failure,
   * so it is left alone.
   */
  addWorkspaceFilesToKnowledgeBase: (payload) => {
    if (lengthOf(payload.added) > 0) return null
    const failed = lengthOf(payload.failed)
    if (failed === 0) return null
    return `Indexed nothing: none of the ${failed} requested ${failed === 1 ? 'file was' : 'files were'} added.`
  },
  bulkDeleteTables: (payload) => {
    const items = payload.deletedItems as { tables?: unknown; folders?: unknown } | undefined
    const deleted = countOf(items?.tables) + countOf(items?.folders)
    if (deleted > 0) return null
    const missed = lengthOf(payload.notFound) + lengthOf(payload.failed)
    if (missed === 0) return null
    return `Deleted nothing: ${missed} of ${missed} ${missed === 1 ? 'item was' : 'items were'} not found or could not be deleted.`
  },
  /**
   * The route answers `200` with `processed: 0` when no listed id matched a
   * chunk in the document, so a sweep over a stale id list read as a success.
   * `errors[0]` names the ids it could not find, which is more use than
   * anything this could restate. A partial hit still succeeds, and a request
   * that listed no chunk at all has nothing to have missed.
   */
  bulkUpdateKnowledgeChunks: (payload, body) => {
    if (countOf(payload.processed) > 0) return null
    const requested = lengthOf(body?.chunkIds)
    if (requested === 0) return null
    const reported = (payload.errors as unknown[] | undefined)?.[0]
    return typeof reported === 'string' && reported
      ? safeOneLine(reported)
      : `Updated nothing: none of the ${requested} requested ${requested === 1 ? 'chunk' : 'chunks'} matched.`
  },
  /**
   * Only the id-list selection is checked. The filter branch answers with a
   * deleted count alone — no `requestedCount` — so the guard below self-excludes
   * on it, which is right: a filter matching nothing deleted nothing because
   * there was nothing to delete, and failing there would break the second run of
   * an otherwise idempotent sweep.
   */
  deleteTableRows: (payload) => {
    if (countOf(payload.deletedCount) > 0) return null
    const requested = countOf(payload.requestedCount)
    if (requested === 0) return null
    return `Deleted nothing: none of the ${requested} requested ${requested === 1 ? 'row was' : 'rows were'} deleted.`
  },
  moveTables: (payload) => {
    if (lengthOf(payload.moved) > 0) return null
    const missed = lengthOf(payload.notFound) + lengthOf(payload.failed)
    if (missed === 0) return null
    return `Moved nothing: ${missed} of ${missed} ${missed === 1 ? 'item was' : 'items were'} not found or could not be moved.`
  },
  moveWorkflows: (payload) => {
    if (lengthOf(payload.moved) > 0) return null
    const failed = lengthOf(payload.failed)
    if (failed === 0) return null
    return `Moved nothing: ${failed} of ${failed} ${failed === 1 ? 'workflow' : 'workflows'} could not be moved.`
  },
}

/** A numeric count field, or `0` when the payload omits it. */
function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** The length of an array field, or `0` when the payload omits it. */
function lengthOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/** The one-line explanation of a bulk call that changed nothing, or `null`. */
function bulkFailureMessage(
  operation: V2OperationName,
  payload: unknown,
  body: Record<string, unknown> | undefined
): string | null {
  const check = BULK_OUTCOME_CHECKS[operation]
  if (!check) return null
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  return check(payload as Record<string, unknown>, body)
}

/**
 * Fields that cap a filtered mutation, beside the id list that supersedes them.
 *
 * `tables rows batch-delete --row a --row b --limit 1` deleted both rows: the
 * route drops `limit` outright on the ids branch, so the cap was accepted,
 * ignored, and never mentioned again. The refusal is client-side because that
 * is where it costs nothing — every already-installed CLI sends `limit: 100`
 * alongside `--row`, so a server that started rejecting the pair would break
 * them all.
 */
const EXCLUSIVE_CAP_FIELDS: Readonly<
  Partial<Record<V2OperationName, { cap: string; ids: string }>>
> = {
  deleteTableRows: { cap: 'limit', ids: 'rowIds' },
}

/**
 * The pager's `--limit`, where `0` means "no ceiling".
 *
 * Read whole, not up to the first character that stops looking numeric.
 * `parseInt` truncated before the guard could see what was typed, so
 * `--limit 3.9` quietly fetched 3, `--limit 1e3` fetched 1, and `--limit -0.5`
 * parsed as `-0` — which is not less than zero, so it slipped the guard and
 * then read as the `0` that means everything. `Number` keeps the value intact
 * so each of those is refused instead of reinterpreted, and it reads `0x10` and
 * `1e3` as the caller wrote them.
 *
 * The empty string is refused explicitly because `Number('')` is `0`: without
 * this, `--limit ''` would go from today's error to an unbounded walk of a
 * shared workspace.
 */
function readPagedLimit(raw: unknown): number {
  const text = String(raw ?? DEFAULT_LIMIT).trim()
  const value = text === '' ? Number.NaN : Number(text)
  if (!Number.isInteger(value) || value < 0) {
    throw new SimApiError('--limit must be a whole number of 0 or more (0 for everything)', 0)
  }
  return value
}

/** Refuses a row cap typed alongside the explicit id list that supersedes it. */
function assertCapIsUsable(operation: V2OperationName, flags: Record<string, unknown>): void {
  const exclusive = EXCLUSIVE_CAP_FIELDS[operation]
  if (!exclusive) return

  const cap = flagNameFor(operation, exclusive.cap)
  const ids = flagNameFor(operation, exclusive.ids)
  if (flags[camel(cap)] === undefined || flags[camel(ids)] === undefined) return
  throw new SimApiError(
    `--${cap} caps a --filter match and does nothing to an explicit --${ids} list; pass one, not both`,
    0
  )
}

/**
 * Operations that select their targets through exactly one of two flags.
 *
 * `tables rows batch-delete` left the choice to the route, whose refusal —
 * `Provide either filter or rowIds, but not both` — describes the wrong mistake
 * when neither was typed, and describes it half in wire names. Its sibling
 * `tables rows batch-update` already refuses locally, because its `filter` is
 * `required` in the contract; stating this one here puts the requirement in the
 * same place for both.
 */
const REQUIRED_SELECTORS: Readonly<
  Partial<
    Record<V2OperationName, { readonly fields: readonly [string, string]; readonly noun: string }>
  >
> = {
  deleteTableRows: { fields: ['filter', 'rowIds'], noun: 'rows to delete' },
}

/** Refuses a selection that names neither of the two ways to make it, or both. */
function assertSelectorIsUsable(operation: V2OperationName, flags: Record<string, unknown>): void {
  const selector = REQUIRED_SELECTORS[operation]
  if (!selector) return

  const [first, second] = selector.fields.map((field) => flagNameFor(operation, field))
  const given = [first, second].filter((name) => flags[camel(name)] !== undefined)
  if (given.length === 1) return
  throw new SimApiError(
    given.length === 0
      ? `--${first} or --${second} is required to choose the ${selector.noun}`
      : `--${first} and --${second} choose the ${selector.noun} two different ways; pass one, not both`,
    0
  )
}

/**
 * Moves a value supplied under a flag's former name onto its current one.
 *
 * Done here rather than in `buildRequest` because this is where the parsed
 * flags are assembled and still keyed by what the caller typed; by the time the
 * request is built, only the current spelling has meaning.
 *
 * Supplying both spellings is refused rather than resolved. They are the same
 * field, so a caller who sets both has two different values in mind and no
 * reading of "the new one wins" is more likely to be the intended one.
 */
function foldRenamedFlags(
  operation: V2OperationName,
  commandSpec: CommandSpec,
  flags: Record<string, unknown>
): void {
  for (const [field, flag] of Object.entries(commandSpec.flags ?? {})) {
    if (!flag.renamedFrom?.length) continue

    const current = flagNameFor(operation, field)
    for (const previous of flag.renamedFrom) {
      const supplied = flags[camel(previous)]
      if (supplied === undefined) continue
      if (flags[camel(current)] !== undefined) {
        throw new SimApiError(
          `--${previous} is the former name of --${current}; pass one, not both`,
          0
        )
      }
      warnRenamedFlag(previous, current)
      flags[camel(current)] = supplied
    }
  }
}

/** Executes a parsed generated command, including cursor pagination. */
export async function executeOperation(
  operation: V2OperationName,
  commandSpec: CommandSpec,
  operationSpec: OperationSpec,
  invocation: unknown[]
): Promise<void> {
  const host = invocation[invocation.length - 1] as Command
  const inheritedFlags = host.optsWithGlobals() as Record<string, unknown>
  const flags: Record<string, unknown> = {
    ...(inheritedFlags.workspace === undefined ? {} : { workspace: inheritedFlags.workspace }),
    ...(inheritedFlags.allWorkspaces === undefined
      ? {}
      : { allWorkspaces: inheritedFlags.allWorkspaces }),
    ...(invocation[invocation.length - 2] as Record<string, unknown>),
  }
  const pathPositionalCount = operationSpec.pathParams.filter(
    (param) => !commandSpec.pathFlags?.[param] && !isProfileWorkspacePath(commandSpec, param)
  ).length
  const positional = invocation.slice(0, pathPositionalCount) as string[]
  const requestFlags: Record<string, unknown> = { ...flags }
  for (const [index, field] of (commandSpec.positionals ?? []).entries()) {
    requestFlags[camel(flagNameFor(operation, field))] = invocation[pathPositionalCount + index]
  }

  foldRenamedFlags(operation, commandSpec, requestFlags)
  assertCapIsUsable(operation, requestFlags)
  assertSelectorIsUsable(operation, requestFlags)

  /**
   * A dry run writes nothing, so it never needs the destructive confirmation.
   *
   * The gate exists to stop a caller discarding work by accident; `--dry-run`
   * is how a caller checks what a command WOULD do, and demanding `--yes` to
   * preview a change teaches people to pass `--yes` reflexively — which is
   * exactly the habit the gate depends on not forming. `dryRun` is a v2-wide
   * contract flag meaning "persist nothing", so this holds for every command
   * that accepts it rather than being a per-command exemption.
   */
  if (commandSpec.confirm && !requestFlags.yes && requestFlags.dryRun !== true) {
    throw new SimApiError(`${commandSpec.confirm} Re-run with --yes to confirm.`, 0)
  }

  if (commandSpec.allWorkspaces && requestFlags.allWorkspaces && requestFlags.workspace) {
    throw new SimApiError('--all-workspaces cannot be combined with --workspace', 0)
  }

  const { client, profile } = clientFrom(host)
  const hasWorkspaceField = Boolean(
    (operationSpec.query && PROFILE_INJECTED_FIELD in operationSpec.query) ||
      (operationSpec.body && PROFILE_INJECTED_FIELD in operationSpec.body)
  )
  const omitsWorkspace = commandSpec.allWorkspaces && requestFlags.allWorkspaces === true
  /**
   * A workspace carried in the path is resolved exactly like one carried in a
   * field. `workspaces get` and `workspaces members` take theirs as a path
   * parameter, so they skipped `requireWorkspace` and fell into `buildRequest`'s
   * own fallback: a second wording for the same precondition, and — because
   * `requireWorkspace` checks the key first — advice to set a workspace on an
   * install whose actual first step is logging in.
   */
  const needsWorkspace =
    (hasWorkspaceField || commandSpec.profileWorkspacePath === true) && !omitsWorkspace
  const paging = cursorSlot(operationSpec)
  /**
   * Checked before the request is built, because `buildRequest` also validates
   * `limit` and would otherwise answer a paginated `--limit 1.5` with the
   * generic integer refusal — losing the `0 for everything` this pager depends
   * on the caller knowing.
   */
  const pagedLimit = paging ? readPagedLimit(requestFlags.limit) : 0
  const request = buildRequest(
    operation,
    positional,
    requestFlags,
    needsWorkspace ? client.requireWorkspace() : profile.workspaceId
  )

  if (paging) {
    const limit = pagedLimit === 0 ? Number.POSITIVE_INFINITY : pagedLimit
    const pageSize = Math.min(Number.isFinite(limit) ? limit : DEFAULT_LIMIT, DEFAULT_LIMIT)
    const pageLimit = 'limit' in (operationSpec[paging] ?? {}) ? { limit: pageSize } : {}
    const rows: unknown[] = []
    const progress = pageProgress()
    let cursor: string | null = null
    /** The first page's envelope: where a fact about the whole query is stated. */
    let envelope: unknown

    // `finally`, for the same reason as `requestAllPages`: a page that throws
    // would otherwise leave the progress text on the line the error prints onto.
    try {
      do {
        const page: V2Page<unknown> = await client.request(request.path, {
          method: operationSpec.method,
          headers: request.headers,
          query: paging === 'query' ? { ...request.query, ...pageLimit, cursor } : request.query,
          body:
            paging === 'body'
              ? { ...(request.body ?? {}), ...pageLimit, ...(cursor ? { cursor } : {}) }
              : request.body,
        })
        envelope = foldPageEnvelope(envelope, page)
        rows.push(...page.data)
        cursor = page.nextCursor
        if (cursor && rows.length < limit) progress.advance(rows.length)
      } while (cursor && rows.length < limit)
    } finally {
      progress.finish()
    }
    // A cursor still in hand means the walk stopped at `--limit`, not at the
    // end of the list — the one fact that separates a clipped answer from a
    // complete one, and it was dropped with the loop variable.
    renderPage(
      profile.output,
      Number.isFinite(limit) ? rows.slice(0, limit) : rows,
      commandSpec,
      envelope,
      { truncated: Boolean(cursor) }
    )
    return
  }

  const result = await client.request<{ data?: unknown }>(request.path, {
    method: operationSpec.method,
    headers: request.headers,
    query: request.query,
    body: request.body,
  })
  const payload = result?.data ?? result
  renderResult(
    operation,
    profile.output,
    payload,
    commandSpec,
    { expandedTrace: requestFlags.trace === true },
    // The envelope, not just the payload: a list that does not paginate states
    // its own truncation there, and unwrapping `data` discarded it.
    result
  )

  // Printed first, then failed, for the reason `followRun` gives: the envelope
  // carries the block outputs that explain *why* the run failed, and exiting
  // before writing it would leave a piped consumer an exit code and nothing to
  // read.
  const failure =
    runFailureMessage(operation, payload) ?? bulkFailureMessage(operation, payload, request.body)
  if (failure) throw new SimApiError(failure, 0)
}
