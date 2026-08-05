import type { Command } from 'commander'
import { clientFrom } from '../context.js'
import type { CommandSpec } from '../contract/types.js'
import type { V2OperationName } from '../generated/v2-api.js'
import { SimApiError, type V2Page } from '../http/client.js'
import { camel } from './derive.js'
import { DEFAULT_LIMIT } from './options.js'
import { buildRequest, flagNameFor, PROFILE_INJECTED_FIELD } from './request.js'
import { renderPage, renderResult } from './result.js'
import type { OperationSpec } from './types.js'

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
  const flags = invocation[invocation.length - 2] as Record<string, unknown>
  const pathPositionalCount = operationSpec.pathParams.filter(
    (param) => !commandSpec.pathFlags?.[param]
  ).length
  const positional = invocation.slice(0, pathPositionalCount) as string[]
  const requestFlags = { ...flags }
  for (const [index, field] of (commandSpec.positionals ?? []).entries()) {
    requestFlags[camel(flagNameFor(operation, field))] = invocation[pathPositionalCount + index]
  }

  if (commandSpec.confirm && !requestFlags.yes) {
    throw new SimApiError(`${commandSpec.confirm} Re-run with --yes to confirm.`, 0)
  }

  const { client, profile } = clientFrom(host)
  const needsWorkspace = Boolean(
    (operationSpec.query && PROFILE_INJECTED_FIELD in operationSpec.query) ||
      (operationSpec.body && PROFILE_INJECTED_FIELD in operationSpec.body)
  )
  const request = buildRequest(
    operation,
    positional,
    requestFlags,
    needsWorkspace ? client.requireWorkspace() : profile.workspaceId
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
  renderResult(operation, profile.output, result?.data ?? result, commandSpec)
}
