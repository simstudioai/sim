import { z } from 'zod'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { fetchProviderJsonWithStatus } from '@/lib/selectors/server/providers/provider-http'
import { detailSelectorResult, listSelectorResult } from '@/lib/selectors/server/types'
import type { SafeSelectorOption, SelectorRequest } from '@/lib/selectors/types'
import type { PlanetScaleScope } from '@/tools/planetscale/types'
import {
  planetScaleApiUrl,
  planetScaleBranchPath,
  planetScaleDatabasePath,
  planetScaleHeaders,
  planetScaleOrganizationPath,
} from '@/tools/planetscale/utils'
import { safeUrlPathSegment } from '@/tools/url-path'

export type PlanetScaleListingKind = 'databases' | 'branches' | 'backups' | 'deployRequests'

const namedResourceSchema = z.object({ id: z.string().min(1), name: z.string().min(1) })
const deployRequestSchema = z.object({
  number: z.number().int().positive(),
  branch: z.string(),
  into_branch: z.string(),
})

function numericPage(value: string | undefined): number {
  if (value === undefined) return 1
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new SelectorContextUnavailableError()
  return Number(value)
}

/** Lists provider resources using names or numbers required by the corresponding action endpoint. */
export async function listPlanetScaleOptions(input: {
  kind: PlanetScaleListingKind
  scope: PlanetScaleScope
  request: SelectorRequest
  signal?: AbortSignal
}) {
  const { kind, scope, request, signal } = input
  signal?.throwIfAborted()
  let path: string
  let headers: Record<string, string>
  let page: number | undefined
  let detailPath = ''
  try {
    headers = planetScaleHeaders(scope)
    path =
      kind === 'databases'
        ? `${planetScaleOrganizationPath(scope.organization)}/databases`
        : kind === 'branches'
          ? `${planetScaleDatabasePath(scope)}/branches`
          : kind === 'backups'
            ? scope.branch
              ? `${planetScaleBranchPath(scope)}/backups`
              : planetScaleDatabasePath(scope)
            : `${planetScaleDatabasePath(scope)}/deploy-requests`
    if (request.kind === 'detail') {
      detailPath = `/${kind === 'deployRequests' ? numericPage(request.id) : safeUrlPathSegment(request.id, 'id')}`
    } else page = numericPage(request.cursor)
  } catch {
    throw new SelectorContextUnavailableError()
  }
  if (kind === 'backups' && !scope.branch) {
    const database = await fetchProviderJsonWithStatus<unknown>(
      planetScaleApiUrl(path),
      { headers, signal },
      { passthroughStatuses: request.kind === 'detail' ? [404] : [] }
    )
    if (!database.ok) return detailSelectorResult(null)
    try {
      const { default_branch } = z
        .object({ default_branch: z.string().min(1) })
        .parse(database.data)
      path += `/branches/${safeUrlPathSegment(default_branch, 'default branch')}/backups`
    } catch {
      throw new SelectorOptionsUnavailableError()
    }
  }
  path += detailPath
  const result = await fetchProviderJsonWithStatus<unknown>(
    planetScaleApiUrl(
      path,
      request.kind === 'list'
        ? {
            page,
            per_page: 100,
            q: kind === 'databases' || kind === 'branches' ? request.search : undefined,
          }
        : {}
    ),
    { headers, signal },
    { passthroughStatuses: request.kind === 'detail' ? [404] : [] }
  )
  if (!result.ok) return detailSelectorResult(null)
  const schema = kind === 'deployRequests' ? deployRequestSchema : namedResourceSchema
  function option(value: unknown): SafeSelectorOption {
    if (kind === 'deployRequests') {
      const item = deployRequestSchema.parse(value)
      return {
        id: String(item.number),
        label: `#${item.number}: ${item.branch} → ${item.into_branch}`,
      }
    }
    const item = namedResourceSchema.parse(value)
    return { id: kind === 'backups' ? item.id : item.name, label: item.name }
  }
  try {
    if (request.kind === 'detail') return detailSelectorResult(option(result.data))
    const payload = z
      .object({ data: z.array(schema).max(100), next_page: z.number().int().positive().nullable() })
      .parse(result.data)
    if (
      payload.next_page !== null &&
      (!Number.isSafeInteger(payload.next_page) || payload.next_page <= page!)
    )
      throw new SelectorOptionsUnavailableError()
    return listSelectorResult(
      payload.data.map(option),
      payload.next_page === null ? undefined : String(payload.next_page)
    )
  } catch {
    throw new SelectorOptionsUnavailableError()
  }
}
