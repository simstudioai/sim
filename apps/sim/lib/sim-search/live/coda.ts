import { nativeText } from '@/lib/sim-search/live/dates'
import { array, object, segment, string } from '@/lib/sim-search/live/http'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'

function document(row: Record<string, unknown>): NativeDocument {
  return {
    id: string(row.id),
    title: string(row.name),
    url: string(row.browserLink),
    content: string(row.name),
    modifiedAt: string(row.updatedAt),
    author: string(row.ownerName),
  }
}

/** Coda REST exposes document discovery, not cross-document full-text retrieval. */
export async function searchCoda(
  client: NativeClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const data = object(
    await client.json('/apis/v1/docs', {
      query: input.native?.cursor
        ? { pageToken: input.native.cursor }
        : {
            ...(nativeText(input) ? { query: nativeText(input) } : {}),
            limit: String(input.limit),
          },
    })
  )
  return {
    documents: array(data.items).map(document),
    nextCursor: string(data.nextPageToken) || undefined,
    partial: true,
    message:
      'Coda REST searches document titles visible to your personal token, not document body text. The newer Superhuman Docs MCP requires a separate MCP grant; existing REST tokens cannot provide its full-text coverage.',
  }
}

export async function readCoda(client: NativeClient, id: string): Promise<NativeDocument> {
  const doc = document(object(await client.json(`/apis/v1/docs/${segment(id)}`)))
  const pages = object(
    await client.json(`/apis/v1/docs/${segment(id)}/pages`, { query: { limit: '25' } })
  )
  const sections: string[] = []
  let incomplete = Boolean(pages.nextPageToken)
  for (const page of array(pages.items).slice(0, 20)) {
    const content = object(
      await client.json(`/apis/v1/docs/${segment(id)}/pages/${segment(string(page.id))}/content`, {
        query: { limit: '500', contentFormat: 'plainText' },
      })
    )
    sections.push(
      `${string(page.name)}\n${array(content.items)
        .map((item) => string(object(item.itemContent).content))
        .join('\n')}`
    )
    incomplete ||= Boolean(content.nextPageToken)
  }
  incomplete ||= array(pages.items).length > 20
  return {
    ...doc,
    content:
      sections.join('\n\n') +
      (incomplete
        ? '\n[Additional pages or content are omitted. Open the source for the remainder.]'
        : ''),
  }
}
