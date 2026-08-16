import type { Command } from 'commander'
import { clientFrom } from '../context'
import type { CommandSpec } from '../contract/types'
import type { V2OperationName } from '../generated/v2-api'
import { SimApiError, type V2Page } from '../http/client'
import { camel } from './derive'
import { DEFAULT_LIMIT } from './options'
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
    let cursor: string | null = null

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
    } while (cursor && rows.length < limit)

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
