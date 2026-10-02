import { z } from 'zod'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  listSelectorResult,
  type ServerSelectorExecutionResult,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption, SelectorRequest } from '@/lib/selectors/types'
import { powerBIHeaders, powerBIUrl, readPowerBIJson } from '@/tools/powerbi/utils'

export type PowerBIListingKind = 'workspaces' | 'datasets' | 'reports'

const WORKSPACE_PAGE_SIZE = 100
const MAX_WORKSPACE_OFFSET = 2_147_483_647
const PROVIDER_TIMEOUT_MS = 30_000
const resourceSchema = z.object({ id: z.string().min(1), name: z.string().min(1) })

function workspaceOffset(value: string | undefined): number {
  if (value === undefined) return 0
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new SelectorContextUnavailableError()
  const offset = Number(value)
  if (!Number.isSafeInteger(offset) || offset > MAX_WORKSPACE_OFFSET) {
    throw new SelectorContextUnavailableError()
  }
  return offset
}

/** Reads one documented Power BI page or detail and projects only endpoint IDs and display names. */
export async function listPowerBIOptions(input: {
  kind: PowerBIListingKind
  accessToken: string
  groupId?: string
  request: SelectorRequest
  signal?: AbortSignal
}): Promise<ServerSelectorExecutionResult> {
  const { kind, accessToken, groupId, request, signal } = input
  signal?.throwIfAborted()
  let url: string
  let headers: Record<string, string>
  let offset = 0
  try {
    headers = powerBIHeaders(accessToken)
    if (kind === 'workspaces') {
      if (request.kind === 'detail') {
        url = powerBIUrl(['groups', request.id])
      } else {
        offset = workspaceOffset(request.cursor)
        url = powerBIUrl(['groups'], { $top: WORKSPACE_PAGE_SIZE, $skip: offset })
      }
    } else {
      if (!groupId || (request.kind === 'list' && request.cursor !== undefined)) {
        throw new SelectorContextUnavailableError()
      }
      url = powerBIUrl(
        request.kind === 'detail'
          ? ['groups', groupId, kind, request.id]
          : ['groups', groupId, kind]
      )
    }
  } catch {
    throw new SelectorContextUnavailableError()
  }

  const timeoutSignal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  const providerSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  let response: Response | undefined
  try {
    // boundary-raw-fetch: Power BI's fixed external origin uses the shared bounded provider reader.
    response = await fetch(url, { headers, signal: providerSignal, redirect: 'error' })
    providerSignal.throwIfAborted()
  } catch {
    await response?.body?.cancel().catch(() => undefined)
    signal?.throwIfAborted()
    throw new SelectorOptionsUnavailableError()
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    signal?.throwIfAborted()
    if (request.kind === 'detail' && response.status === 404) return detailSelectorResult(null)
    throw selectorProviderStatusError(response.status)
  }
  try {
    const data = await readPowerBIJson<unknown>(response, providerSignal)
    providerSignal.throwIfAborted()
    function option(value: unknown): SafeSelectorOption {
      const resource = resourceSchema.parse(value)
      return { id: resource.id, label: resource.name }
    }
    if (request.kind === 'detail') return detailSelectorResult(option(data))
    const payload = z.object({ value: z.array(resourceSchema) }).parse(data)
    const pageSize = payload.value.length
    if (kind === 'workspaces' && pageSize > WORKSPACE_PAGE_SIZE) {
      throw new SelectorOptionsUnavailableError()
    }
    const nextOffset = offset + WORKSPACE_PAGE_SIZE
    if (
      kind === 'workspaces' &&
      pageSize === WORKSPACE_PAGE_SIZE &&
      nextOffset > MAX_WORKSPACE_OFFSET
    ) {
      throw new SelectorOptionsUnavailableError()
    }
    return listSelectorResult(
      payload.value.map((resource) => ({ id: resource.id, label: resource.name })),
      kind === 'workspaces' && pageSize === WORKSPACE_PAGE_SIZE ? String(nextOffset) : undefined
    )
  } catch {
    signal?.throwIfAborted()
    throw new SelectorOptionsUnavailableError()
  }
}
