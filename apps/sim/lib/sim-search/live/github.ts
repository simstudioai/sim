import {
  dateSortDirection,
  hasDateBounds,
  nativeDateBounds,
  nativeText,
} from '@/lib/sim-search/live/dates'
import { array, NativeSearchError, object, segment, string } from '@/lib/sim-search/live/http'
import { collectNativePages, joinMessages } from '@/lib/sim-search/live/pages'
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

/**
 * Code search rejects a `q` over 1,000 UTF-8 bytes with qualifiers counted, although the
 * documentation cites only 256 characters of text. Batches keep a small margin under it.
 */
const GITHUB_CODE_QUERY_BYTES = 980
/**
 * Issue and repository search limit only free text to 256 characters and accept roughly 4,000
 * bytes of repository qualifiers; batches leave room for type and date qualifiers appended later.
 */
const GITHUB_ISSUE_QUERY_BYTES = 3800
/** Batches per kind; each code batch spends one of GitHub's ten code searches per minute. */
const GITHUB_MAX_REPOSITORY_BATCHES = 4

type GitHubKind = 'issues' | 'code' | 'repositories'
const CODE_EXCLUDED_BY_DATES = 'Code has no dates and is excluded from date-filtered searches.'

/** Code has no file dates, so a date-bounded search covers issues and pull requests only. */
function githubKinds(input: NativeSearchInput): GitHubKind[] {
  const kind = input.native?.kind
  if (kind === 'issues' || kind === 'code' || kind === 'repositories') return [kind]
  if (kind)
    throw new NativeSearchError(
      'unavailable',
      'GitHub search supports issues, code, or repositories.'
    )
  return hasDateBounds(input.filters) ? ['issues'] : ['issues', 'code']
}

/**
 * Splits repositories into qualifier batches that keep each query within `maxBytes`. A
 * repository whose qualifier cannot fit beside the query at all is left out.
 */
function repositoryBatches(query: string, names: readonly string[], maxBytes: number): string[][] {
  const base = Buffer.byteLength(query)
  const batches: string[][] = []
  let batch: string[] = []
  let bytes = base
  for (const name of names) {
    const term = Buffer.byteLength(` repo:${name}`)
    if (base + term > maxBytes) continue
    if (bytes + term > maxBytes) {
      if (batches.push(batch) === GITHUB_MAX_REPOSITORY_BATCHES) return batches
      batch = []
      bytes = base
    }
    batch.push(name)
    bytes += term
  }
  if (batch.length) batches.push(batch)
  return batches
}

/** `key:value` or `key:"quoted value"`, excluding URLs such as `https://…`. */
const GITHUB_QUALIFIER = /^-?[a-z][\w-]*:(?!\/\/)\S/i

/**
 * Groups free text so boolean operators cannot absorb appended qualifiers. GitHub treats a
 * qualifier inside parentheses as search text, so qualifiers stay outside the group. A query
 * that already uses parentheses is structured by its author and is left as written.
 */
function groupGitHubText(query: string): string {
  if (!query || /[()]/.test(query)) return query
  const tokens = query.match(/-?[\w-]+:"[^"]*"|-?"[^"]*"|\S+/g) ?? []
  const qualifiers = tokens.filter((token) => GITHUB_QUALIFIER.test(token))
  const text = tokens.filter((token) => !GITHUB_QUALIFIER.test(token)).join(' ')
  return [text ? `(${text})` : '', ...qualifiers].filter(Boolean).join(' ')
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
    const kinds = githubKinds(input)
    const planned = kinds.map((kind) => ({
      kind,
      repositories: repositoryBatches(
        query,
        names,
        kind === 'code' ? GITHUB_CODE_QUERY_BYTES : GITHUB_ISSUE_QUERY_BYTES
      ),
    }))
    const batches = planned.filter(({ repositories }) => repositories.length)
    const skipped = planned.filter(({ repositories }) => !repositories.length)
    if (!batches.length)
      throw new NativeSearchError(
        'unavailable',
        'This query is too long to scope to your GitHub repositories. Shorten it or add a repo: qualifier.'
      )
    const searched = Math.min(
      ...batches.map(({ repositories }) =>
        repositories.reduce((count, batch) => count + batch.length, 0)
      )
    )
    /** Batches merge within their kind first, so a kind with more batches cannot crowd out another. */
    const result = await collectNativePages(
      batches.map(({ kind, repositories }) =>
        collectNativePages(
          repositories.map((batch) =>
            searchGitHub(client, {
              ...input,
              native: {
                provider: 'github',
                ...input.native,
                kind,
                query: [query, ...batch.map((name) => `repo:${name}`)].filter(Boolean).join(' '),
              },
            })
          ),
          ''
        )
      ),
      'Searched repositories you own, collaborate on, or access through organization membership. Use a repo: qualifier to narrow results.'
    )
    const capped = repositories.length === 100 || searched < names.length
    return {
      ...result,
      partial: result.partial || capped || skipped.length > 0,
      message: joinMessages([
        result.message,
        ...skipped.map(
          ({ kind }) =>
            `GitHub ${kind} search was skipped because the query is too long to scope to repositories.`
        ),
        !input.native?.kind && !kinds.includes('code') ? CODE_EXCLUDED_BY_DATES : undefined,
        capped
          ? `Only the ${searched} most recently pushed repositories were searched; target a repository for broader coverage.`
          : undefined,
      ]),
    }
  }
  if (!input.native?.kind) {
    const kinds = githubKinds(input)
    return collectNativePages(
      kinds.map((kind) =>
        searchGitHub(client, {
          ...input,
          native: { provider: 'github', ...input.native, query, kind },
        })
      ),
      kinds.includes('code')
        ? 'Searched GitHub issues, pull requests, and code.'
        : `Searched GitHub issues and pull requests. ${CODE_EXCLUDED_BY_DATES}`
    )
  }
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
  const [kind] = githubKinds(input)
  if (kind === 'code' && hasDateBounds(input.filters))
    throw new NativeSearchError(
      'unavailable',
      'GitHub code search does not provide file modification dates. Date-filtered coverage includes issues and pull requests, not code.'
    )
  const dates = nativeDateBounds(input)
  const text = nativeText(input)
  /** GitHub ORs repeated qualifiers, so both bounds must share one `updated:` range. */
  const updated =
    dates.start && dates.end
      ? `updated:${dates.start}..${dates.end}`
      : dates.start
        ? `updated:>=${dates.start}`
        : dates.end
          ? `updated:<=${dates.end}`
          : ''
  const datedQuery =
    kind === 'issues' ? [groupGitHubText(text), updated].filter(Boolean).join(' ') : text
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
        ...(kind === 'issues' && dateSortDirection(input.filters)
          ? { sort: 'updated', order: dateSortDirection(input.filters) }
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
    hasMore: total > 1000,
    partial: data.incomplete_results === true,
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
