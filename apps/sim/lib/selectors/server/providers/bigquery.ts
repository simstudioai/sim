import { z } from 'zod'
import { getScopesForService } from '@/lib/oauth/utils'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type BigQuerySelectorKey = Extract<ServerSelectorKey, 'bigquery.datasets' | 'bigquery.tables'>

const BIGQUERY_MAX_PAGES = 20
const BIGQUERY_PAGE_SIZE = 200
const BIGQUERY_SCOPES = getScopesForService('google-bigquery')

const bigQueryDatasetSchema = z.object({
  datasetReference: z.object({
    datasetId: z.string().min(1),
    projectId: z.string().min(1),
  }),
  friendlyName: z.string().optional(),
})

const bigQueryTableSchema = z.object({
  tableReference: z.object({ tableId: z.string().min(1) }),
  friendlyName: z.string().optional(),
})

const datasetsPageSchema = z.object({
  datasets: z.array(bigQueryDatasetSchema).max(BIGQUERY_PAGE_SIZE).optional(),
  nextPageToken: z.string().min(1).max(4_096).optional(),
})

const tablesPageSchema = z.object({
  tables: z.array(bigQueryTableSchema).max(BIGQUERY_PAGE_SIZE).optional(),
  nextPageToken: z.string().min(1).max(4_096).optional(),
})

function requireCredential(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return args.credential
}

function requireContext(value: string | undefined): string {
  if (!value) throw new SelectorContextUnavailableError()
  return value
}

async function getAccessToken(args: ExecuteServerSelectorArgs): Promise<string> {
  return resolveSelectorOAuthAccessToken({
    credential: requireCredential(args),
    serviceId: 'google-bigquery',
    scopes: BIGQUERY_SCOPES,
    impersonateEmail: args.context.impersonateUserEmail,
    protectedValues: args.protectedValues,
  })
}

async function listDatasets(args: ExecuteServerSelectorArgs) {
  const projectId = requireContext(args.context.projectId)
  const accessToken = await getAccessToken(args)
  const datasets: z.infer<typeof bigQueryDatasetSchema>[] = []
  let pageToken: string | undefined

  for (let page = 0; page < BIGQUERY_MAX_PAGES; page++) {
    const url = new URL(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets`
    )
    url.searchParams.set('maxResults', String(BIGQUERY_PAGE_SIZE))
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const body = await fetchProviderJson<unknown>(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: args.signal,
    })
    const parsed = datasetsPageSchema.safeParse(body)
    if (!parsed.success) throw new SelectorOptionsUnavailableError()

    datasets.push(...(parsed.data.datasets ?? []))
    pageToken = parsed.data.nextPageToken
    if (!pageToken) break
  }

  return datasets.map((dataset) => ({
    id: dataset.datasetReference.datasetId,
    label: dataset.friendlyName || dataset.datasetReference.datasetId,
  }))
}

async function listTables(args: ExecuteServerSelectorArgs) {
  const projectId = requireContext(args.context.projectId)
  const datasetId = requireContext(args.context.datasetId)
  const accessToken = await getAccessToken(args)
  const tables: z.infer<typeof bigQueryTableSchema>[] = []
  let pageToken: string | undefined

  for (let page = 0; page < BIGQUERY_MAX_PAGES; page++) {
    const url = new URL(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/tables`
    )
    url.searchParams.set('maxResults', String(BIGQUERY_PAGE_SIZE))
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const body = await fetchProviderJson<unknown>(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: args.signal,
    })
    const parsed = tablesPageSchema.safeParse(body)
    if (!parsed.success) throw new SelectorOptionsUnavailableError()

    tables.push(...(parsed.data.tables ?? []))
    pageToken = parsed.data.nextPageToken
    if (!pageToken) break
  }

  return tables.map((table) => ({
    id: table.tableReference.tableId,
    label: table.friendlyName || table.tableReference.tableId,
  }))
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['google-bigquery'],
} as const

export const bigQuerySelectorAttachments = {
  'bigquery.datasets': {
    credential,
    destination: 'fixed',
    async execute(args) {
      return flatSelectorResult(args.request, await listDatasets(args), true)
    },
  },
  'bigquery.tables': {
    credential,
    destination: 'fixed',
    async execute(args) {
      return flatSelectorResult(args.request, await listTables(args), true)
    },
  },
} satisfies ServerSelectorAttachmentMap<BigQuerySelectorKey>
