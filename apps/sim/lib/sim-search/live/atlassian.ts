import { dateSortDirection, nativeDateBounds, nativeText } from '@/lib/sim-search/live/dates'
import {
  array,
  NativeSearchError,
  object,
  segment,
  string,
  textContent,
} from '@/lib/sim-search/live/http'
import { interleaveByRank } from '@/lib/sim-search/live/pages'
import { providerText } from '@/lib/sim-search/live/text'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'

export const escapeSearchPhrase = (value: string) =>
  JSON.stringify(value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&'))

/** Place trusted scope before ORDER BY while respecting quoted JQL/CQL values. */
export function scopeAtlassianQuery(query: string, scope?: string, order?: string): string {
  if (!scope && !order) return query
  let quote = ''
  for (let i = 0; i < query.length; i++) {
    const char = query[i]
    if (char === '\\') {
      i++
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if ((i === 0 || /\s/.test(query[i - 1]!)) && /^order\s+by\b/i.test(query.slice(i))) {
      const filter = query.slice(0, i).trim()
      return `${scope ? `${filter ? `(${filter}) AND ` : ''}${scope}` : filter} ${order ? `ORDER BY ${order}` : query.slice(i)}`.trim()
    }
  }
  const result = scope ? (query.trim() ? `(${query}) AND ${scope}` : scope) : query
  return order ? `${result} ORDER BY ${order}`.trim() : result
}

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
  if (string(row.entityType) === 'space') {
    const space = object(row.space)
    return {
      id: string(space.key),
      kind: 'space',
      accessMetadata: { spaceKey: string(space.key) },
      container: cloudId,
      title: string(row.title) || string(space.name),
      url: `${site}/wiki${string(row.url) || `/spaces/${segment(string(space.key))}`}`,
      content: providerText(string(row.excerpt), 'html') || string(row.title),
      modifiedAt: string(row.lastModified),
    }
  }
  const content = Object.keys(object(row.content)).length ? object(row.content) : row
  const links = object(content._links)
  const version = object(content.version)
  const spaceKey = string(object(content.space).key)
  return {
    id: string(content.id),
    kind: string(content.type) === 'blogpost' ? 'blogpost' : 'page',
    ...(spaceKey ? { accessMetadata: { spaceKey } } : {}),
    container: cloudId,
    title: string(content.title) || string(row.title),
    url: `${site}/wiki${string(links.webui) || `/pages/${segment(string(content.id))}`}`,
    content:
      providerText(string(object(object(content.body).view).value), 'html') ||
      providerText(string(row.excerpt).replace(/@@@(?:end)?hl@@@/g, ''), 'html') ||
      string(content.title),
    modifiedAt: string(version.when) || string(row.lastModified),
    author: string(object(version.by).displayName),
  }
}
/** The sites a grant can reach, requested once per client and shared with its verifier. */
async function sites(client: NativeClient) {
  return array(await client.json('/oauth/token/accessible-resources', { memo: true }))
}

export async function searchAtlassian(
  client: NativeClient,
  provider: 'jira' | 'confluence',
  input: NativeSearchInput
): Promise<NativePage> {
  const allSites = (await sites(client)).filter(
    (site) =>
      !input.policy?.sites.length ||
      input.policy.sites.includes(new URL(string(site.url)).host.toLowerCase())
  )
  const selected = input.native?.project
    ? allSites.filter((site) => string(site.id) === input.native?.project)
    : allSites.slice(0, 4)
  if (!selected.length)
    throw new NativeSearchError(
      'reconnect',
      'No accessible Atlassian site matches this account or site ID.'
    )
  const single = selected.length === 1
  const policyScope =
    input.policy?.mode === 'selected'
      ? `(${input.policy.included.map((id) => `${provider === 'jira' ? 'project' : 'space'} = ${JSON.stringify(id)}`).join(' OR ')})`
      : undefined
  const dates = nativeDateBounds(input)
  const field = provider === 'jira' ? 'updated' : 'lastmodified'
  const scope =
    [
      policyScope,
      dates.start
        ? `${field} >= "${new Date(Date.parse(dates.start) - 86400000).toISOString().slice(0, 10)}"`
        : '',
      dates.end
        ? `${field} <= "${new Date(Date.parse(dates.end) + 86400000).toISOString().slice(0, 10)}"`
        : '',
    ]
      .filter(Boolean)
      .join(' AND ') || undefined
  const direction = dateSortDirection(input.filters)
  const order = direction ? `${field} ${direction.toUpperCase()}` : undefined
  const text = nativeText(input)
  const pages = await Promise.all(
    selected.map(async (site) => {
      const cloudId = string(site.id)
      const origin = string(site.url).replace(/\/$/, '')
      if (provider === 'jira') {
        const data = object(
          await client.json(`/ex/jira/${segment(cloudId)}/rest/api/3/search/jql`, {
            body: {
              jql: scopeAtlassianQuery(
                input.native?.query || (text ? `text ~ ${escapeSearchPhrase(text)}` : ''),
                scope,
                order
              ),
              maxResults: input.limit,
              fields: ['summary', 'description', 'updated', 'creator', 'status'],
              ...(input.native?.cursor && single ? { nextPageToken: input.native.cursor } : {}),
            },
          })
        )
        return {
          documents: array(data.issues).map((row) => issue(row, cloudId, origin)),
          next: string(data.nextPageToken) || undefined,
        }
      }
      const data = object(
        await client.json(`/ex/confluence/${segment(cloudId)}/wiki/rest/api/search`, {
          query: {
            cql: scopeAtlassianQuery(
              input.native?.query ||
                `type IN (page, blogpost)${text ? ` AND text ~ ${escapeSearchPhrase(text)}` : ''}`,
              scope,
              order
            ),
            limit: String(input.limit),
            expand: 'content.version,content.space',
            ...(input.native?.cursor && single ? { cursor: input.native.cursor } : {}),
          },
        })
      )
      const next = string(object(data._links).next)
      return {
        documents: array(data.results).map((row) => page(row, cloudId, origin)),
        next: next
          ? (new URL(next, 'https://api.atlassian.com').searchParams.get('cursor') ?? undefined)
          : undefined,
      }
    })
  )
  const documents = interleaveByRank(pages.map((result) => result.documents))
  return {
    documents,
    partial: !input.native?.project && allSites.length > selected.length,
    hasMore: pages.some((result) => Boolean(result.next)),
    nextCursor: single ? pages[0]?.next : undefined,
    message:
      'Searches up to four accessible Atlassian sites. For a specific site and pagination, set project to its cloud ID.',
  }
}

export async function readAtlassian(
  client: NativeClient,
  provider: 'jira' | 'confluence',
  id: string,
  cloudId?: string,
  kind?: string
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
  return readConfluence(client, cloudId, string(site.url), id, kind)
}

/**
 * Reads through the v2 API, whose page, blog post, and space endpoints need only the granular
 * read scopes a Search connection grants; v1 content reads also need read:content-details.
 * A space is read as its homepage.
 */
async function readConfluence(
  client: NativeClient,
  cloudId: string,
  site: string,
  id: string,
  kind?: string
): Promise<NativeDocument> {
  const api = `/ex/confluence/${segment(cloudId)}/wiki/api/v2`
  let title: string | undefined
  let contentId = id
  let contentKind = kind === 'blogpost' ? 'blogpost' : 'page'
  if (kind === 'space') {
    const space = object(
      array(object(await client.json(`${api}/spaces`, { query: { keys: id } })).results)[0]
    )
    if (!string(space.homepageId))
      throw new NativeSearchError('unavailable', 'The Confluence space has no readable homepage.')
    title = string(space.name)
    contentId = string(space.homepageId)
    contentKind = 'page'
  }
  const content = (type: string) =>
    client.json(`${api}/${type}/${segment(contentId)}`, { query: { 'body-format': 'view' } })
  /** A reference issued before kinds were recorded may name a blog post; its page read is a 404. */
  const row = object(
    kind === undefined
      ? await content('pages').catch((error: unknown) => {
          if (error instanceof NativeSearchError && error.httpStatus === 404) {
            contentKind = 'blogpost'
            return content('blogposts')
          }
          throw error
        })
      : await content(contentKind === 'blogpost' ? 'blogposts' : 'pages')
  )
  const pageTitle = string(row.title)
  return {
    id,
    kind: kind === 'space' ? 'space' : contentKind,
    container: cloudId,
    title: title || pageTitle,
    url: `${site}/wiki${string(object(row._links).webui) || `/pages/${segment(contentId)}`}`,
    content:
      providerText(string(object(object(row.body).view).value), 'html') || title || pageTitle,
    modifiedAt: string(object(row.version).createdAt) || string(row.createdAt),
  }
}
