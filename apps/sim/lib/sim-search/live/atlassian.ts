import {
  array,
  NativeSearchError,
  object,
  segment,
  string,
  textContent,
} from '@/lib/sim-search/live/http'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'

export const escapeSearchPhrase = (value: string) =>
  JSON.stringify(value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&'))

function issue(row: Record<string, unknown>, cloudId: string, site: string): NativeDocument {
  const fields = object(row.fields)
  return {
    id: string(row.key),
    container: cloudId,
    title: `${string(row.key)}: ${string(fields.summary)}`,
    url: `${site}/browse/${segment(string(row.key))}`,
    content: [
      string(fields.summary),
      textContent(fields.description),
      `Status: ${string(object(fields.status).name)}`,
      ...array(object(fields.comment).comments).map((c) => textContent(c.body)),
    ]
      .filter(Boolean)
      .join('\n'),
    modifiedAt: string(fields.updated),
    author: string(object(fields.creator).displayName),
  }
}
function page(row: Record<string, unknown>, cloudId: string, site: string): NativeDocument {
  const content = Object.keys(object(row.content)).length ? object(row.content) : row
  const links = object(content._links)
  const version = object(content.version)
  return {
    id: string(content.id),
    container: cloudId,
    title: string(content.title) || string(row.title),
    url: `${site}/wiki${string(links.webui) || `/pages/${segment(string(content.id))}`}`,
    content:
      string(object(object(content.body).view).value).replace(/<[^>]*>/g, ' ') ||
      string(row.excerpt).replace(/<[^>]*>/g, ' ') ||
      string(content.title),
    modifiedAt: string(version.when) || string(row.lastModified),
    author: string(object(version.by).displayName),
  }
}
async function sites(client: NativeClient) {
  return array(await client.json('/oauth/token/accessible-resources'))
}

export async function searchAtlassian(
  client: NativeClient,
  provider: 'jira' | 'confluence',
  input: NativeSearchInput
): Promise<NativePage> {
  const allSites = await sites(client)
  const selected = input.native?.project
    ? allSites.filter((site) => string(site.id) === input.native?.project)
    : allSites.slice(0, 4)
  if (!selected.length)
    throw new NativeSearchError(
      'reconnect',
      'No accessible Atlassian site matches this account or site ID.'
    )
  const documents: NativeDocument[] = []
  let partial = !input.native?.project && allSites.length > selected.length
  let nextCursor: string | undefined
  for (const site of selected) {
    const cloudId = string(site.id)
    const origin = string(site.url).replace(/\/$/, '')
    if (provider === 'jira') {
      const data = object(
        await client.json(`/ex/jira/${segment(cloudId)}/rest/api/3/search/jql`, {
          body: {
            jql: input.native?.query ?? `text ~ ${escapeSearchPhrase(input.query)}`,
            maxResults: input.limit,
            fields: ['summary', 'description', 'updated', 'creator', 'status'],
            ...(input.native?.cursor && selected.length === 1
              ? { nextPageToken: input.native.cursor }
              : {}),
          },
        })
      )
      documents.push(...array(data.issues).map((row) => issue(row, cloudId, origin)))
      partial ||= Boolean(data.nextPageToken)
      if (selected.length === 1) nextCursor = string(data.nextPageToken) || undefined
    } else {
      const data = object(
        await client.json(`/ex/confluence/${segment(cloudId)}/wiki/rest/api/search`, {
          query: {
            cql: input.native?.query ?? `type = page AND text ~ ${escapeSearchPhrase(input.query)}`,
            limit: String(input.limit),
            expand: 'content.version',
            ...(input.native?.cursor && selected.length === 1
              ? { cursor: input.native.cursor }
              : {}),
          },
        })
      )
      documents.push(...array(data.results).map((row) => page(row, cloudId, origin)))
      const next = string(object(data._links).next)
      partial ||= Boolean(next)
      if (next && selected.length === 1)
        nextCursor =
          new URL(next, 'https://api.atlassian.com').searchParams.get('cursor') ?? undefined
    }
  }
  return {
    documents,
    partial,
    nextCursor,
    message:
      'Searches up to four accessible Atlassian sites. For a specific site and pagination, set project to its cloud ID.',
  }
}

export async function readAtlassian(
  client: NativeClient,
  provider: 'jira' | 'confluence',
  id: string,
  cloudId?: string
): Promise<NativeDocument> {
  const site = (await sites(client)).find((row) => string(row.id) === cloudId)
  if (!site || !cloudId)
    throw new NativeSearchError('reconnect', 'The Atlassian site is no longer accessible.')
  if (provider === 'jira')
    return issue(
      object(
        await client.json(`/ex/jira/${segment(cloudId)}/rest/api/3/issue/${segment(id)}`, {
          query: { fields: 'summary,description,updated,creator,status,comment' },
        })
      ),
      cloudId,
      string(site.url)
    )
  return page(
    object(
      await client.json(`/ex/confluence/${segment(cloudId)}/wiki/rest/api/content/${segment(id)}`, {
        query: { expand: 'body.view,version' },
      })
    ),
    cloudId,
    string(site.url)
  )
}
