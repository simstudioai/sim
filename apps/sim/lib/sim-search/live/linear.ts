import { dateSortDirection, nativeDateBounds, nativeText } from '@/lib/sim-search/live/dates'
import { readDiscussionSection } from '@/lib/sim-search/live/discussion'
import { array, NativeSearchError, object, string } from '@/lib/sim-search/live/http'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const COMMENT_PAGE_SIZE = 50
const ISSUE_FIELDS = `
  id identifier title description url updatedAt archivedAt
  creator { name } assignee { name } state { name }
  team { id name } project { id name }
`

/** Linear returns GraphQL failures with HTTP 200, including quota and revoked access. */
async function linearQuery(
  client: NativeClient,
  query: string,
  variables: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result = object(await client.json('/graphql', { body: { query, variables } }))
  const errors = array(result.errors)
  if (errors.length) {
    const codes = errors.map((error) => string(object(error.extensions).code).toUpperCase())
    if (codes.some((code) => ['RATELIMITED', 'RATE_LIMITED', 'RATE_LIMIT_EXCEEDED'].includes(code)))
      throw new NativeSearchError(
        'rate_limited',
        'Linear search rate limit reached. Try again later.'
      )
    if (
      codes.some((code) => ['AUTHENTICATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN'].includes(code))
    )
      throw new NativeSearchError('reconnect', 'Linear denied access. Reconnect your account.')
    throw new NativeSearchError(
      'unavailable',
      'Linear could not complete this query. Check your query and access.'
    )
  }
  if (!result.data)
    throw new NativeSearchError('unavailable', 'Linear returned an unsupported response format.')
  return object(result.data)
}

function linearUrl(value: unknown): string {
  try {
    const url = new URL(string(value))
    return url.protocol === 'https:' &&
      url.hostname === 'linear.app' &&
      !url.port &&
      !url.username &&
      !url.password
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

function issueDocument(issue: Record<string, unknown>): NativeDocument | undefined {
  const id = string(issue.id)
  const url = linearUrl(issue.url)
  if (!UUID.test(id) || !url) return undefined
  const project = object(issue.project)
  const team = object(issue.team)
  const metadata = [
    string(object(issue.state).name) && `Status: ${string(object(issue.state).name)}`,
    string(object(issue.assignee).name) && `Assignee: ${string(object(issue.assignee).name)}`,
    string(project.name) && `Project: ${string(project.name)}`,
    issue.archivedAt ? 'Archived issue' : '',
  ].filter(Boolean)
  return {
    id,
    kind: 'issue',
    title: [string(issue.identifier), string(issue.title)].filter(Boolean).join(' — '),
    url,
    content: [string(issue.description), metadata.join('\n')].filter(Boolean).join('\n\n'),
    container: string(team.id) || undefined,
    containerName: string(team.name) || undefined,
    modifiedAt: string(issue.updatedAt) || undefined,
    author: string(object(issue.creator).name) || undefined,
  }
}

export async function searchLinear(
  client: NativeClient,
  input: NativeSearchInput
): Promise<NativePage> {
  if (input.native?.project && !UUID.test(input.native.project))
    throw new NativeSearchError('unavailable', 'Linear project scope requires a project UUID.')
  const term = nativeText(input)
  const bounds = nativeDateBounds(input)
  const direction = dateSortDirection(input.filters)
  const backwards = direction === 'asc'
  const filter: Record<string, unknown> = {
    ...(input.native?.project ? { project: { id: { eq: input.native.project } } } : {}),
    ...(bounds.start || bounds.end
      ? {
          updatedAt: {
            ...(bounds.start ? { gte: bounds.start } : {}),
            ...(bounds.end ? { lt: bounds.end } : {}),
          },
        }
      : {}),
  }
  const pagination = backwards
    ? { last: Math.min(input.limit, 50), before: input.native?.cursor }
    : { first: Math.min(input.limit, 50), after: input.native?.cursor }
  const variables = {
    ...pagination,
    filter,
    includeArchived: true,
    ...(direction || !term ? { orderBy: 'updatedAt' } : {}),
    ...(term ? { term, includeComments: true } : {}),
  }
  const field = term ? 'searchIssues' : 'issues'
  const data = await linearQuery(
    client,
    `
    query SearchLinearIssues(
      $first: Int, $after: String, $last: Int, $before: String,
      $filter: IssueFilter, $includeArchived: Boolean, $orderBy: PaginationOrderBy
      ${term ? ', $term: String!, $includeComments: Boolean' : ''}
    ) {
      ${field}(
        first: $first, after: $after, last: $last, before: $before,
        filter: $filter, includeArchived: $includeArchived, orderBy: $orderBy
        ${term ? ', term: $term, includeComments: $includeComments' : ''}
      ) {
        nodes { ${ISSUE_FIELDS} }
        pageInfo { hasNextPage endCursor hasPreviousPage startCursor }
      }
    }
  `,
    variables
  )
  const result = object(data[field])
  if (
    !Array.isArray(result.nodes) ||
    typeof object(result.pageInfo)[backwards ? 'hasPreviousPage' : 'hasNextPage'] !== 'boolean'
  )
    throw new NativeSearchError(
      'unavailable',
      'Linear search returned an unsupported result format.'
    )
  const rows = array(result.nodes)
  const ordered = backwards ? [...rows].reverse() : rows
  const documents = ordered.slice(0, input.limit).flatMap((row) => {
    const document = issueDocument(row)
    return document ? [document] : []
  })
  const pageInfo = object(result.pageInfo)
  const hasMore = backwards ? pageInfo.hasPreviousPage === true : pageInfo.hasNextPage === true
  const cursor = string(backwards ? pageInfo.startCursor : pageInfo.endCursor)
  const clipped = rows.length > input.limit
  return {
    documents,
    nextCursor: hasMore && cursor && !clipped ? cursor : undefined,
    hasMore,
    partial: documents.length < rows.length || (hasMore && !cursor),
    message:
      'Linear searches issue titles, descriptions, and comments, including archived issues. Read an issue to inspect its discussion. Project scope uses a project UUID; date filters use issue modification time.' +
      (hasMore && !cursor
        ? ' Linear omitted its continuation; narrow the query for more results.'
        : ''),
  }
}

export async function readLinear(client: NativeClient, id: string): Promise<NativeDocument> {
  if (!UUID.test(id)) throw new NativeSearchError('unavailable', 'Invalid Linear issue reference.')
  const data = await linearQuery(
    client,
    `
    query ReadLinearIssue($id: String!) {
      issue(id: $id) { ${ISSUE_FIELDS} }
    }
  `,
    { id }
  )
  const issue = object(data.issue)
  if (string(issue.id) !== id)
    throw new NativeSearchError(
      'unavailable',
      'Linear issue identity changed or is no longer readable.'
    )
  const document = issueDocument(issue)
  if (!document)
    throw new NativeSearchError('unavailable', 'Linear returned an unsupported issue format.')
  const seen = new Set<string>()
  const discussion = await readDiscussionSection('Issue discussion', async (after) => {
    const data = await linearQuery(
      client,
      `
      query ReadLinearComments($id: String!, $first: Int!, $after: String) {
        issue(id: $id) {
          id
          comments(first: $first, after: $after, orderBy: createdAt) {
            nodes { id body url createdAt updatedAt user { name } parent { id } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `,
      { id, first: COMMENT_PAGE_SIZE, after }
    )
    const issue = object(data.issue)
    if (string(issue.id) !== id)
      throw new NativeSearchError(
        'unavailable',
        'Linear issue identity changed while reading comments.'
      )
    const connection = object(issue.comments)
    const pageInfo = object(connection.pageInfo)
    if (
      !Array.isArray(connection.nodes) ||
      typeof pageInfo.hasNextPage !== 'boolean' ||
      (pageInfo.hasNextPage && !string(pageInfo.endCursor))
    )
      throw new NativeSearchError('unavailable', 'Linear returned an incomplete discussion page.')
    function* entries() {
      for (const comment of array(connection.nodes).slice(0, COMMENT_PAGE_SIZE)) {
        const commentId = string(comment.id)
        if (!commentId)
          throw new NativeSearchError('unavailable', 'Linear returned an incomplete comment.')
        if (seen.has(commentId)) continue
        seen.add(commentId)
        yield [
          [string(object(comment.user).name) || 'Unknown author', string(comment.createdAt)]
            .filter(Boolean)
            .join(' · '),
          string(object(comment.parent).id) ? `Reply to ${string(object(comment.parent).id)}` : '',
          linearUrl(comment.url),
          string(comment.body),
        ]
          .filter(Boolean)
          .join('\n')
      }
    }
    return {
      entries: entries(),
      nextCursor: pageInfo.hasNextPage ? string(pageInfo.endCursor) : undefined,
    }
  })
  return {
    ...document,
    content: [discussion.warning, document.content, discussion.content]
      .filter(Boolean)
      .join('\n\n'),
  }
}
