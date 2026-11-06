import { toRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { z } from 'zod'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { normalizeJamaInstanceUrl } from '@/lib/jama/client'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/http'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { jamaId, jamaUrl } from '@/tools/jama/utils'

type JamaSelectorKey = Extract<ServerSelectorKey, 'jama.projects' | 'jama.itemTypes'>

const PAGE_SIZE = 50
const credential = { kind: 'stored', field: 'oauthCredential', serviceIds: ['jama'] } as const

interface JamaDestination {
  accessToken: string
  instanceUrl: string
}

const resourceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().optional(),
  display: z.string().optional(),
  fields: z.object({ name: z.string().optional() }).optional(),
})

const pageSchema = z.object({
  data: z.array(resourceSchema).max(PAGE_SIZE),
  meta: z.object({
    pageInfo: z.object({
      startIndex: z.number().int().nonnegative(),
      resultCount: z.number().int().min(0).max(PAGE_SIZE),
      totalResults: z.number().int().nonnegative(),
    }),
  }),
})

async function prepareJamaDestination(args: ExecuteServerSelectorArgs): Promise<JamaDestination> {
  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  if (!bundle.instanceUrl) throw new SelectorConnectionUnavailableError()
  try {
    return {
      accessToken: bundle.accessToken,
      instanceUrl: normalizeJamaInstanceUrl(bundle.instanceUrl),
    }
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}

function resourceId(value: string): string {
  try {
    return jamaId(value, 'Resource ID')
  } catch {
    throw new SelectorContextUnavailableError()
  }
}

async function fetchJama(
  args: ExecuteServerSelectorArgs,
  destination: JamaDestination,
  path: string,
  query: Record<string, number> = {},
  allowMissing = false
): Promise<unknown> {
  let response: Awaited<ReturnType<typeof secureFetchWithValidation>>
  try {
    response = await secureFetchWithValidation(jamaUrl(destination.instanceUrl, path, query), {
      profile: 'configuredEndpoint',
      method: 'GET',
      headers: { Authorization: `Bearer ${destination.accessToken}`, Accept: 'application/json' },
      maxRedirects: 0,
      maxResponseBytes: 2 * 1024 * 1024,
      timeout: 15_000,
      signal: args.signal,
      logUrlValidationDetails: false,
    })
  } catch (error) {
    if (args.signal?.aborted) throw error
    throw new SelectorOptionsUnavailableError()
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    if (allowMissing && response.status === 404) return null
    throw selectorProviderStatusError(response.status)
  }
  try {
    return await response.json()
  } catch (error) {
    if (args.signal?.aborted) throw error
    throw new SelectorOptionsUnavailableError()
  }
}

function option(resource: z.infer<typeof resourceSchema>): SafeSelectorOption {
  return {
    id: String(resource.id),
    label: truncate(
      resource.display?.trim() ||
        resource.name?.trim() ||
        resource.fields?.name?.trim() ||
        String(resource.id),
      200
    ),
  }
}

async function listJamaResources(
  args: ExecuteServerSelectorArgs,
  destination: JamaDestination,
  path: string
) {
  const request = requireListRequest(args.selectorKey, args.request)
  const cursor = request.cursor ?? '0'
  const startAt = Number(cursor)
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(startAt) || startAt < 0) {
    throw new SelectorContextUnavailableError()
  }
  const parsed = pageSchema.safeParse(
    await fetchJama(args, destination, path, {
      startAt,
      maxResults: PAGE_SIZE,
    })
  )
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  const {
    data,
    meta: { pageInfo },
  } = parsed.data
  if (pageInfo.startIndex !== startAt || pageInfo.resultCount !== data.length) {
    throw new SelectorOptionsUnavailableError()
  }
  const next = startAt + pageInfo.resultCount
  return listSelectorResult(
    data.map(option),
    data.length > 0 && Number.isSafeInteger(next) && next < pageInfo.totalResults
      ? String(next)
      : undefined
  )
}

export const jamaSelectorAttachments = {
  'jama.projects': definePreparedSelectorAttachment({
    credential,
    destination: { kind: 'credential-bound', prepare: prepareJamaDestination },
    execute: async (args, destination) => {
      if (args.request.kind === 'detail') {
        const body = await fetchJama(
          args,
          destination,
          `/projects/${resourceId(args.request.id)}`,
          {},
          true
        )
        if (body === null) return detailSelectorResult(null)
        const parsed = resourceSchema.safeParse(toRecord(body).data)
        if (!parsed.success) throw new SelectorOptionsUnavailableError()
        return detailSelectorResult(option(parsed.data))
      }
      return listJamaResources(args, destination, '/projects')
    },
  }),
  'jama.itemTypes': definePreparedSelectorAttachment({
    credential,
    destination: { kind: 'credential-bound', prepare: prepareJamaDestination },
    execute: async (args, destination) =>
      listJamaResources(
        args,
        destination,
        args.context.projectId
          ? `/projects/${resourceId(args.context.projectId)}/itemtypes`
          : '/itemtypes'
      ),
  }),
} satisfies ServerSelectorAttachmentMap<JamaSelectorKey>
