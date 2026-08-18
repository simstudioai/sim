import type { Command } from 'commander'
import { clientFrom } from '../context'
import type { CommandSpec } from '../contract/types'
import type { V2OperationName } from '../generated/v2-api'
import { pageProgress, SimApiError, type V2Page } from '../http/client'
import { camel } from './derive'
import { DEFAULT_LIMIT } from './options'
import { warnRenamedFlag } from './renamed'
import {
  buildRequest,
  flagNameFor,
  isProfileWorkspacePath,
  PROFILE_INJECTED_FIELD,
} from './request'
import { renderPage, renderResult } from './result'
import type { OperationSpec } from './types'

function cursorSlot(operationSpec: OperationSpec): 'query' | 'body' | null {
  if (operationSpec.query && 'cursor' in operationSpec.query) return 'query'
  if (operationSpec.body && 'cursor' in operationSpec.body) return 'body'
  return null
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

  if (commandSpec.confirm && !requestFlags.yes) {
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
  const request = buildRequest(
    operation,
    positional,
    requestFlags,
    hasWorkspaceField && !omitsWorkspace ? client.requireWorkspace() : profile.workspaceId
  )
  const paging = cursorSlot(operationSpec)

  if (paging) {
    const rawLimit = Number.parseInt(String(requestFlags.limit ?? DEFAULT_LIMIT), 10)
    if (Number.isNaN(rawLimit) || rawLimit < 0) {
      throw new SimApiError('--limit must be a non-negative number', 0)
    }

    const limit = rawLimit === 0 ? Number.POSITIVE_INFINITY : rawLimit
    const pageSize = Math.min(Number.isFinite(limit) ? limit : DEFAULT_LIMIT, DEFAULT_LIMIT)
    const pageLimit = 'limit' in (operationSpec[paging] ?? {}) ? { limit: pageSize } : {}
    const rows: unknown[] = []
    const progress = pageProgress()
    let cursor: string | null = null

    // `finally`, for the same reason as `requestAllPages`: a page that throws
    // would otherwise leave the progress text on the line the error prints onto.
    try {
      do {
        const page: V2Page<unknown> = await client.request(request.path, {
          method: operationSpec.method,
          query: paging === 'query' ? { ...request.query, ...pageLimit, cursor } : request.query,
          body:
            paging === 'body'
              ? { ...(request.body ?? {}), ...pageLimit, ...(cursor ? { cursor } : {}) }
              : request.body,
        })
        rows.push(...page.data)
        cursor = page.nextCursor
        if (cursor && rows.length < limit) progress.advance(rows.length)
      } while (cursor && rows.length < limit)
    } finally {
      progress.finish()
    }
    renderPage(profile.output, Number.isFinite(limit) ? rows.slice(0, limit) : rows, commandSpec)
    return
  }

  const result = await client.request<{ data?: unknown }>(request.path, {
    method: operationSpec.method,
    query: request.query,
    body: request.body,
  })
  renderResult(operation, profile.output, result?.data ?? result, commandSpec, {
    expandedTrace: requestFlags.trace === true,
  })
}
