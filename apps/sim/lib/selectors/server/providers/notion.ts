import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { extractTitleFromItem } from '@/tools/notion/utils'

type NotionSelectorKey = Extract<ServerSelectorKey, 'notion.databases' | 'notion.pages'>

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['notion'],
} as const

const PAGE_SIZE = 100
const MAX_PAGES = 20

interface NotionSearchPage {
  results?: unknown[]
  has_more?: boolean
  next_cursor?: string | null
}

async function listNotionObjects(
  args: ExecuteServerSelectorArgs,
  object: 'database' | 'page'
): Promise<SafeSelectorOption[]> {
  if (!args.credential) throw new SelectorOptionsUnavailableError()
  const token = await resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'notion',
    protectedValues: args.protectedValues,
  })
  const results: unknown[] = []
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchProviderJson<NotionSearchPage>('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        filter: { value: object, property: 'object' },
        page_size: PAGE_SIZE,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
      signal: args.signal,
      redirect: 'error',
    })
    if (Array.isArray(data.results)) results.push(...data.results)
    if (!data.has_more || !data.next_cursor) break
    cursor = data.next_cursor
  }

  return results.flatMap((value) => {
    if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') {
      return []
    }
    return [{ id: (value as { id: string }).id, label: extractTitleFromItem(value) }]
  })
}

export const notionSelectorAttachments = {
  'notion.databases': {
    credential,
    destination: 'fixed',
    execute: async (args) =>
      flatSelectorResult(args.request, await listNotionObjects(args, 'database'), true),
  },
  'notion.pages': {
    credential,
    destination: 'fixed',
    execute: async (args) =>
      flatSelectorResult(args.request, await listNotionObjects(args, 'page'), true),
  },
} satisfies ServerSelectorAttachmentMap<NotionSelectorKey>
