import { hasDateBounds, nativeDateBounds, nativeText } from '@/lib/sim-search/live/dates'
import { array, NativeSearchError, object, segment, string } from '@/lib/sim-search/live/http'
import { collectNativePages } from '@/lib/sim-search/live/pages'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'

function githubDocument(row: Record<string, unknown>, kind: string): NativeDocument {
  const repository = object(row.repository)
  const repositoryUrl = string(row.repository_url)
  const container =
    string(repository.full_name) ||
    repositoryUrl.replace('https://api.github.com/repos/', '') ||
    string(row.full_name)
  return {
    id:
      kind === 'code'
        ? string(row.path)
        : kind === 'repositories'
          ? string(row.full_name)
          : string(row.number),
    container,
    kind,
    title:
      kind === 'code'
        ? `${container} · ${string(row.path)}`
        : `${container} · ${string(row.title) || string(row.name) || string(row.full_name)}`,
    url: string(row.html_url),
    content:
      string(row.body) ||
      string(row.description) ||
      array(row.text_matches)
        .map((match) => string(match.fragment))
        .join('\n') ||
      string(row.path),
    modifiedAt: string(row.updated_at),
    author: string(object(row.user).login) || string(object(row.owner).login),
  }
}

export async function searchGitHub(
  client: NativeClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const query = input.native?.query ?? input.query
  if (!/(?:^|\s)(?:repo|org|user):[^\s]+/i.test(query)) {
    const repositories = array(
      await client.json('/user/repos', {
        query: {
          affiliation: 'owner,collaborator,organization_member',
          per_page: '100',
          sort: 'pushed',
        },
      })
    )
    const names = repositories
      .map((row) => string(row.full_name))
      .filter((name) => /^[\w.-]+\/[\w.-]+$/.test(name))
    if (!names.length)
      return {
        documents: [],
        message: 'No repositories are accessible through this GitHub connection.',
      }
    const batches: string[][] = []
    for (let offset = 0; offset < names.length; offset += 25)
      batches.push(names.slice(offset, offset + 25))
    const pages: Promise<NativePage>[] = []
    for (const names of batches) {
      pages.push(
        searchGitHub(client, {
          ...input,
          native: {
            provider: 'github',
            ...input.native,
            query: `${query} ${names.map((name) => `repo:${name}`).join(' ')}`,
          },
        })
      )
    }
    const result = await collectNativePages(
      pages,
      'Searched repositories you own, collaborate on, or access through organization membership. Use a repo: qualifier to narrow results.'
    )
    return {
      ...result,
      partial: result.partial || repositories.length === 100,
      message:
        repositories.length === 100
          ? `${result.message} Only the 100 most recently pushed repositories were searched; target a repository for broader coverage.`
          : result.message,
    }
  }
  if (!input.native?.kind)
    return collectNativePages(
      ['issues', 'code'].map((kind) =>
        searchGitHub(client, {
          ...input,
          native: {
            provider: 'github',
            ...input.native,
            query,
            kind: kind === 'code' ? 'code' : 'issues',
          },
        })
      ),
      'Searched GitHub issues, pull requests, and code.'
    )
  if (
    input.native.kind === 'issues' &&
    !/(?:^|\s)(?:is|type):(?:issue|pr|pull-request)(?:\s|$)/i.test(query)
  )
    return collectNativePages(
      ['issue', 'pull-request'].map((kind) =>
        searchGitHub(client, {
          ...input,
          native: { ...input.native!, query: `${query} is:${kind}` },
        })
      ),
      'Searched issues and pull requests separately.'
    )
  const kind = input.native?.kind ?? 'issues'
  if (!['issues', 'code', 'repositories'].includes(kind))
    throw new NativeSearchError(
      'unavailable',
      'GitHub search supports issues, code, or repositories.'
    )
  if (kind === 'code' && hasDateBounds(input.filters))
    throw new NativeSearchError(
      'unavailable',
      'GitHub code search does not provide file modification dates. Date-filtered coverage includes issues and pull requests, not code.'
    )
  const dates = nativeDateBounds(input)
  const text = nativeText(input)
  const datedQuery =
    kind === 'issues'
      ? [
          text ? `(${text})` : '',
          dates.start ? `updated:>=${dates.start}` : '',
          dates.end ? `updated:<=${dates.end}` : '',
        ]
          .filter(Boolean)
          .join(' ')
      : text
  const page = input.native?.cursor ?? '1'
  if (!/^\d{1,3}$/.test(page) || Number(page) < 1)
    throw new NativeSearchError('unavailable', 'Invalid GitHub page.')
  let response: unknown
  try {
    response = await client.json(`/search/${kind}`, {
      query: {
        q: hasDateBounds(input.filters) ? datedQuery : text,
        per_page: String(input.limit),
        page,
        ...(kind === 'issues' && input.filters?.sortBy && input.filters.sortBy !== 'relevance'
          ? { sort: 'updated', order: input.filters.sortBy === 'oldest' ? 'asc' : 'desc' }
          : {}),
      },
    })
  } catch (error) {
    if (error instanceof NativeSearchError)
      throw new NativeSearchError(
        error.status,
        `GitHub ${kind} search: ${error.message}`,
        error.retryAfterSeconds
      )
    throw error
  }
  const data = object(response)
  const total = Number(data.total_count)
  const nextCursor =
    Number(page) * input.limit < Math.min(total, 1000) ? String(Number(page) + 1) : undefined
  return {
    documents: array(data.items).map((row) => githubDocument(row, kind)),
    nextCursor,
    partial: data.incomplete_results === true || total > 1000,
    message:
      kind === 'code'
        ? 'GitHub REST code search covers the default branch and files below 384 KB; code queries have a separate rate limit. Read results for file contents.'
        : 'GitHub native search supports qualifiers and returns at most 1,000 results per query. Narrow large searches.',
  }
}

export async function readGitHub(
  client: NativeClient,
  id: string,
  repository?: string,
  kind?: string
): Promise<NativeDocument> {
  if (
    !repository ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    repository.split('/').some((part) => part === '..' || part === '.')
  )
    throw new NativeSearchError('unavailable', 'Invalid GitHub repository reference.')
  const path = `/repos/${repository}`
  if (kind === 'code') {
    if (id.split('/').some((part) => part === '..' || part === '.'))
      throw new NativeSearchError('unavailable', 'Invalid file path.')
    const row = object(
      await client.json(`${path}/contents/${id.split('/').map(segment).join('/')}`)
    )
    if (row.encoding !== 'base64')
      throw new NativeSearchError(
        'unavailable',
        'This file is too large or cannot be read through the contents API.'
      )
    return {
      id,
      container: repository,
      kind,
      title: string(row.name),
      url: string(row.html_url),
      content: Buffer.from(string(row.content), 'base64').toString('utf8'),
    }
  }
  if (kind === 'repositories') {
    const row = object(await client.json(path))
    return githubDocument(row, 'repositories')
  }
  if (!/^\d+$/.test(id))
    throw new NativeSearchError('unavailable', 'Invalid GitHub issue reference.')
  return githubDocument(object(await client.json(`${path}/issues/${id}`)), 'issues')
}
