import { z } from 'zod'
import { getScopesForService } from '@/lib/oauth/utils'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type HubSpotSelectorKey = Extract<
  ServerSelectorKey,
  | 'hubspot.properties'
  | 'hubspot.lists'
  | 'hubspot.pipelines'
  | 'hubspot.pipelineStages'
  | 'hubspot.owners'
>

const BUILT_IN_PATH: Record<string, string> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
  ticket: 'tickets',
}

const HUBSPOT_LISTS_PAGE_SIZE = 500

const hubspotListSchema = z.object({
  listId: z.string().min(1).max(100),
  name: z.string().min(1).max(1_000),
  deletedAt: z.string().nullable().optional(),
})

const hubspotListsPageSchema = z.object({
  hasMore: z.boolean(),
  lists: z.array(hubspotListSchema).max(HUBSPOT_LISTS_PAGE_SIZE),
  offset: z.number().int().nonnegative(),
})

const hubspotListDetailSchema = z.object({
  list: hubspotListSchema,
})

function resolveObjectType(args: ExecuteServerSelectorArgs): string | null {
  const selected = args.context.objectType ?? 'contact'
  if (selected !== 'custom') return selected
  return args.context.customObjectTypeId?.trim() || null
}

async function hubspotToken(args: ExecuteServerSelectorArgs): Promise<string> {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  try {
    return await resolveSelectorOAuthAccessToken({
      credential: args.credential,
      serviceId: 'hubspot',
      scopes: getScopesForService('hubspot'),
      protectedValues: args.protectedValues,
    })
  } catch (error) {
    if (error instanceof SelectorConnectionUnavailableError) throw error
    throw new SelectorConnectionUnavailableError()
  }
}

async function executeProperties(args: ExecuteServerSelectorArgs) {
  requireListRequest(args.selectorKey, args.request)
  const objectType = resolveObjectType(args)
  if (!objectType) return listSelectorResult([])
  const accessToken = await hubspotToken(args)
  const path = BUILT_IN_PATH[objectType] ?? objectType
  const data = await fetchProviderJson<{
    results?: Array<{
      name: string
      label: string
      hidden?: boolean
      archived?: boolean
    }>
  }>(`https://api.hubapi.com/crm/v3/properties/${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: args.signal,
  })
  if (!Array.isArray(data.results)) throw new SelectorOptionsUnavailableError()
  return listSelectorResult(
    data.results
      .filter((property) => !property.hidden && !property.archived && property.name)
      .map((property) => ({ id: property.name, label: property.label || property.name }))
      .sort((left, right) => left.label.localeCompare(right.label))
  )
}

async function executeLists(args: ExecuteServerSelectorArgs) {
  const accessToken = await hubspotToken(args)
  if (args.request.kind === 'detail') {
    const listId = args.request.id.trim()
    if (!listId || listId.length > 100) throw new SelectorContextUnavailableError()
    const body = await fetchProviderJson<unknown>(
      `https://api.hubapi.com/crm/v3/lists/${encodeURIComponent(listId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: args.signal,
      }
    )
    const parsed = hubspotListDetailSchema.safeParse(body)
    if (!parsed.success) throw new SelectorOptionsUnavailableError()
    const list = parsed.data.list
    return detailSelectorResult(list.deletedAt ? null : { id: args.request.id, label: list.name })
  }

  requireListRequest(args.selectorKey, args.request)
  const cursor = args.request.cursor
  if (cursor && !/^\d{1,10}$/.test(cursor)) throw new SelectorContextUnavailableError()
  const offset = cursor ? Number(cursor) : 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_SELECTOR_OPTIONS) {
    throw new SelectorContextUnavailableError()
  }
  const search = args.request.search?.trim()
  const body = await fetchProviderJson<unknown>('https://api.hubapi.com/crm/v3/lists/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      count: HUBSPOT_LISTS_PAGE_SIZE,
      offset,
      ...(search ? { query: search } : {}),
      processingTypes: ['MANUAL', 'DYNAMIC', 'SNAPSHOT'],
    }),
    signal: args.signal,
  })
  const parsed = hubspotListsPageSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  const data = parsed.data
  if (data.hasMore && data.offset <= offset) throw new SelectorOptionsUnavailableError()
  return listSelectorResult(
    data.lists
      .filter((list) => !list.deletedAt && list.listId && list.name)
      .map((list) => ({ id: list.listId, label: list.name }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    data.hasMore ? String(data.offset) : undefined
  )
}

interface HubSpotPipeline {
  id: string
  label: string
  stages?: Array<{ id: string; label: string }>
  archived?: boolean
}

async function loadPipelines(args: ExecuteServerSelectorArgs): Promise<HubSpotPipeline[]> {
  const objectType = resolveObjectType(args)
  if (!objectType) return []
  const accessToken = await hubspotToken(args)
  const path = BUILT_IN_PATH[objectType] ?? objectType
  const data = await fetchProviderJson<{ results?: HubSpotPipeline[] }>(
    `https://api.hubapi.com/crm/v3/pipelines/${encodeURIComponent(path)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: args.signal }
  )
  return (data.results ?? []).filter((pipeline) => !pipeline.archived)
}

async function executePipelines(args: ExecuteServerSelectorArgs) {
  requireListRequest(args.selectorKey, args.request)
  const pipelines = await loadPipelines(args)
  return listSelectorResult(
    pipelines
      .filter((pipeline) => pipeline.id && pipeline.label)
      .map((pipeline) => ({ id: pipeline.id, label: pipeline.label }))
      .sort((left, right) => left.label.localeCompare(right.label))
  )
}

async function executePipelineStages(args: ExecuteServerSelectorArgs) {
  requireListRequest(args.selectorKey, args.request)
  const pipelineId = args.context.pipelineId
  if (!pipelineId) throw new SelectorContextUnavailableError()
  const pipeline = (await loadPipelines(args)).find((candidate) => candidate.id === pipelineId)
  return listSelectorResult(
    (pipeline?.stages ?? [])
      .filter((stage) => stage.id && stage.label)
      .map((stage) => ({ id: stage.id, label: stage.label }))
  )
}

async function executeOwners(args: ExecuteServerSelectorArgs) {
  requireListRequest(args.selectorKey, args.request)
  const accessToken = await hubspotToken(args)
  const owners: Array<{
    id: string
    email?: string
    firstName?: string
    lastName?: string
    archived?: boolean
  }> = []
  let after: string | undefined
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://api.hubapi.com/crm/v3/owners')
    url.searchParams.set('limit', '100')
    if (after) url.searchParams.set('after', after)
    const data = await fetchProviderJson<{
      results?: typeof owners
      paging?: { next?: { after?: string } }
    }>(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: args.signal })
    owners.push(...(data.results ?? []))
    after = data.paging?.next?.after
    if (!after) break
  }
  return listSelectorResult(
    owners
      .filter((owner) => !owner.archived && owner.id)
      .map((owner) => ({
        id: owner.id,
        label:
          [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email || owner.id,
      }))
      .sort((left, right) => left.label.localeCompare(right.label))
  )
}

const credential = { kind: 'stored', field: 'oauthCredential', serviceIds: ['hubspot'] } as const

export const hubspotSelectorAttachments = {
  'hubspot.properties': { credential, destination: 'fixed', execute: executeProperties },
  'hubspot.lists': { credential, destination: 'fixed', execute: executeLists },
  'hubspot.pipelines': { credential, destination: 'fixed', execute: executePipelines },
  'hubspot.pipelineStages': {
    credential,
    destination: 'fixed',
    execute: executePipelineStages,
  },
  'hubspot.owners': { credential, destination: 'fixed', execute: executeOwners },
} satisfies ServerSelectorAttachmentMap<HubSpotSelectorKey>
