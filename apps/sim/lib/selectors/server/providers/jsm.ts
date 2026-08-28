import { z } from 'zod'
import { getScopesForService } from '@/lib/oauth/utils'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorAtlassianCloudId } from '@/lib/selectors/server/providers/atlassian'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import { getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

type JsmSelectorKey = Extract<ServerSelectorKey, 'jsm.serviceDesks' | 'jsm.requestTypes'>

const JIRA_SCOPES = getScopesForService('jira')
const JSM_PAGE_SIZE = 100
const MAX_JSM_PAGES = 50

const serviceDeskSchema = z.object({
  id: z.string().min(1).max(100),
  projectName: z.string().min(1).max(1_000),
})

const requestTypeSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(1_000),
})

function pagedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    values: z.array(item).max(JSM_PAGE_SIZE).optional(),
    isLastPage: z.boolean().optional(),
    _links: z.object({ next: z.string().max(4_096).optional() }).optional(),
  })
}

function requireServiceDeskId(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(trimmed)) {
    throw new SelectorContextUnavailableError()
  }
  return trimmed
}

function requireDetailId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 100) throw new SelectorContextUnavailableError()
  return trimmed
}

async function resolveJsmAuth(args: ExecuteServerSelectorArgs) {
  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    scopes: JIRA_SCOPES,
    protectedValues: args.protectedValues,
  })
  const cloudId = await resolveSelectorAtlassianCloudId({
    accessToken: bundle.accessToken,
    domain: args.context.domain,
    providedCloudId: bundle.cloudId,
    product: 'Jira',
    signal: args.signal,
  })
  return { accessToken: bundle.accessToken, cloudId }
}

async function drainJsmPages<T>(input: {
  args: ExecuteServerSelectorArgs
  accessToken: string
  baseUrl: string
  schema: z.ZodType<T>
}): Promise<T[]> {
  const rows: T[] = []
  let start = 0

  for (let page = 0; page < MAX_JSM_PAGES; page++) {
    const url = new URL(input.baseUrl)
    url.searchParams.set('start', String(start))
    url.searchParams.set('limit', String(JSM_PAGE_SIZE))
    const body = await fetchProviderJson<unknown>(url, {
      headers: getJsmHeaders(input.accessToken),
      redirect: 'error',
      signal: input.args.signal,
    })
    const parsed = pagedSchema(input.schema).safeParse(body)
    if (!parsed.success) throw new SelectorOptionsUnavailableError()
    const values = parsed.data.values ?? []
    rows.push(...values)
    if (parsed.data.isLastPage === true || !parsed.data._links?.next || values.length === 0) {
      break
    }
    start += values.length
  }

  return rows
}

async function serviceDeskOptions(args: ExecuteServerSelectorArgs) {
  const auth = await resolveJsmAuth(args)
  const rows = await drainJsmPages({
    args,
    ...auth,
    baseUrl: `${getJsmApiBaseUrl(auth.cloudId)}/servicedesk`,
    schema: serviceDeskSchema,
  })
  return rows.map((row) => ({ id: row.id, label: row.projectName }))
}

async function requestTypeOptions(args: ExecuteServerSelectorArgs) {
  const serviceDeskId = requireServiceDeskId(args.context.serviceDeskId)
  const auth = await resolveJsmAuth(args)
  const rows = await drainJsmPages({
    args,
    ...auth,
    baseUrl: `${getJsmApiBaseUrl(auth.cloudId)}/servicedesk/${encodeURIComponent(serviceDeskId)}/requesttype`,
    schema: requestTypeSchema,
  })
  return rows.map((row) => ({ id: row.id, label: row.name }))
}

function resultForRequest(
  args: ExecuteServerSelectorArgs,
  items: Array<{ id: string; label: string }>
) {
  if (args.request.kind === 'list') return listSelectorResult(items)
  const id = requireDetailId(args.request.id)
  return detailSelectorResult(items.find((item) => item.id === id) ?? null)
}

const credential = { kind: 'stored', field: 'oauthCredential', serviceIds: ['jira'] } as const

export const jsmSelectorAttachments = {
  'jsm.serviceDesks': {
    credential,
    destination: 'fixed',
    execute: async (args) => resultForRequest(args, await serviceDeskOptions(args)),
  },
  'jsm.requestTypes': {
    credential,
    destination: 'fixed',
    execute: async (args) => resultForRequest(args, await requestTypeOptions(args)),
  },
} satisfies ServerSelectorAttachmentMap<JsmSelectorKey>
