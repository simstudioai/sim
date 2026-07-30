import {
  GITHUB_GRAPHQL_MAX_PAGE_SIZE,
  GITHUB_GRAPHQL_URL,
  githubGraphQlHeaders,
  parsePageInfo,
  readGraphQlData,
} from '@/tools/github/graphql'
import {
  isRecord,
  nullableNumber,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from '@/tools/github/response-parsers'
import type {
  ListReviewThreadsParams,
  ListReviewThreadsResponse,
  ReviewThread,
  ReviewThreadComment,
  SubmittedReviewSummary,
} from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

const CONTEXT = 'GitHub review threads response'
const DEFAULT_THREADS_PER_PAGE = 50
const DEFAULT_COMMENTS_PER_THREAD = 50

/**
 * Validates a page size before it reaches the query, so an out-of-range value
 * fails with a readable message instead of as a GraphQL error payload.
 */
function pageSize(value: number | undefined, fallback: number, field: string): number {
  const size = value ?? fallback
  if (!Number.isSafeInteger(size) || size < 1 || size > GITHUB_GRAPHQL_MAX_PAGE_SIZE) {
    throw new Error(`${field} must be an integer between 1 and ${GITHUB_GRAPHQL_MAX_PAGE_SIZE}`)
  }
  return size
}

/**
 * One page of a pull request's review threads plus, at no extra cost, the newest
 * submitted review. Each thread carries `comments.totalCount` alongside the
 * fetched comments so a caller can tell a fully-read conversation from a
 * truncated one, and each comment carries the author's association and
 * `__typename` so a caller can decide whether the whole thread is trusted.
 */
const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $threads: Int!, $comments: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: $threads, after: $cursor) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            path
            line
            comments(first: $comments) {
              totalCount
              nodes {
                body
                authorAssociation
                author { login __typename }
              }
            }
          }
        }
        reviews(last: 1, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
          nodes {
            state
            submittedAt
            author { login __typename }
          }
        }
      }
    }
  }
`

/** GitHub returns `author: null` for a deleted account, so both fields are nullable. */
function parseAuthor(
  value: unknown,
  context: string
): { authorLogin: string | null; authorType: string | null } {
  if (value === null || value === undefined) return { authorLogin: null, authorType: null }
  if (!isRecord(value)) throw new Error(`${context} must be an object or null`)
  return {
    authorLogin: requiredString(value, 'login', context),
    authorType: requiredString(value, '__typename', context),
  }
}

function parseComment(value: unknown, context: string): ReviewThreadComment {
  if (!isRecord(value)) throw new Error(`${context} must be an object`)
  return {
    body: requiredString(value, 'body', context),
    authorAssociation: requiredString(value, 'authorAssociation', context),
    ...parseAuthor(value.author, `${context}.author`),
  }
}

function parseThread(value: unknown, index: number): ReviewThread {
  const context = `${CONTEXT}.threads[${index}]`
  if (!isRecord(value)) throw new Error(`${context} must be an object`)

  const comments = value.comments
  if (!isRecord(comments)) throw new Error(`${context}.comments must be an object`)
  const commentNodes = comments.nodes
  if (!Array.isArray(commentNodes)) throw new Error(`${context}.comments.nodes must be an array`)

  return {
    id: requiredString(value, 'id', context),
    isResolved: requiredBoolean(value, 'isResolved', context),
    path: requiredString(value, 'path', context),
    line: nullableNumber(value, 'line', context),
    commentsTotalCount: requiredNumber(comments, 'totalCount', `${context}.comments`),
    comments: commentNodes.map((node, commentIndex) =>
      parseComment(node, `${context}.comments[${commentIndex}]`)
    ),
  }
}

function parseLatestReview(value: unknown): SubmittedReviewSummary | null {
  if (!isRecord(value)) throw new Error(`${CONTEXT}.reviews must be an object`)
  const nodes = value.nodes
  if (!Array.isArray(nodes)) throw new Error(`${CONTEXT}.reviews.nodes must be an array`)
  const newest: unknown = nodes.at(-1)
  if (newest === undefined) return null

  const context = `${CONTEXT}.reviews.latest`
  if (!isRecord(newest)) throw new Error(`${context} must be an object`)
  const submittedAt = newest.submittedAt
  if (typeof submittedAt !== 'string') {
    throw new Error(`${context}.submittedAt must be a string`)
  }
  return {
    state: requiredString(newest, 'state', context),
    submittedAt,
    ...parseAuthor(newest.author, `${context}.author`),
  }
}

export const listReviewThreadsTool: ToolConfig<ListReviewThreadsParams, ListReviewThreadsResponse> =
  {
    id: 'github_list_review_threads',
    name: 'GitHub List Review Threads',
    description:
      "List one page of a pull request's review threads with their comments, plus the newest submitted review.",
    version: '1.0.0',

    params: {
      owner: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Repository owner',
      },
      repo: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Repository name',
      },
      pullNumber: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Pull request number',
      },
      threadsPerPage: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Review threads to fetch in this page (1-100)',
        default: DEFAULT_THREADS_PER_PAGE,
      },
      commentsPerThread: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comments to fetch per thread (1-100)',
        default: DEFAULT_COMMENTS_PER_THREAD,
      },
      cursor: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Cursor from a previous page (endCursor) to continue from',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'GitHub API token with pull request read access',
      },
    },

    request: {
      url: GITHUB_GRAPHQL_URL,
      method: 'POST',
      headers: (params) => githubGraphQlHeaders(params.apiKey),
      body: (params) => ({
        query: REVIEW_THREADS_QUERY,
        variables: {
          owner: params.owner,
          repo: params.repo,
          number: params.pullNumber,
          threads: pageSize(params.threadsPerPage, DEFAULT_THREADS_PER_PAGE, 'threadsPerPage'),
          comments: pageSize(
            params.commentsPerThread,
            DEFAULT_COMMENTS_PER_THREAD,
            'commentsPerThread'
          ),
          cursor: params.cursor ?? null,
        },
      }),
    },

    transformResponse: async (response) => {
      const data = await readGraphQlData(response, CONTEXT)

      const repository = data.repository
      if (!isRecord(repository)) throw new Error(`${CONTEXT}.repository was not found`)
      const pullRequest = repository.pullRequest
      if (!isRecord(pullRequest)) throw new Error(`${CONTEXT}.pullRequest was not found`)

      const reviewThreads = pullRequest.reviewThreads
      if (!isRecord(reviewThreads)) throw new Error(`${CONTEXT}.reviewThreads must be an object`)
      const nodes = reviewThreads.nodes
      if (!Array.isArray(nodes)) throw new Error(`${CONTEXT}.reviewThreads.nodes must be an array`)

      const { hasNextPage, endCursor } = parsePageInfo(
        reviewThreads.pageInfo,
        `${CONTEXT}.reviewThreads.pageInfo`
      )

      return {
        success: true,
        output: {
          threads: nodes.map(parseThread),
          totalCount: requiredNumber(reviewThreads, 'totalCount', `${CONTEXT}.reviewThreads`),
          hasNextPage,
          endCursor,
          latestReview: parseLatestReview(pullRequest.reviews),
        },
      }
    },

    outputs: {
      threads: {
        type: 'array',
        description: 'Review threads in this page',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Review thread node ID' },
            isResolved: { type: 'boolean', description: 'Whether the thread is resolved' },
            path: { type: 'string', description: 'Repository-relative file path' },
            line: { type: 'number', description: 'Line the thread is anchored to', nullable: true },
            commentsTotalCount: {
              type: 'number',
              description:
                'Total comments on the thread; exceeds the fetched count when the thread was truncated',
            },
            comments: {
              type: 'array',
              description: 'Fetched comments, oldest first',
              items: {
                type: 'object',
                properties: {
                  body: { type: 'string', description: 'Comment body' },
                  authorAssociation: {
                    type: 'string',
                    description: "Author's association with the repository (OWNER, MEMBER, ...)",
                  },
                  authorLogin: { type: 'string', description: 'Author login', nullable: true },
                  authorType: {
                    type: 'string',
                    description: 'Author GraphQL type (User, Bot, Organization)',
                    nullable: true,
                  },
                },
              },
            },
          },
        },
      },
      totalCount: { type: 'number', description: 'Total review threads on the pull request' },
      hasNextPage: { type: 'boolean', description: 'Whether more thread pages remain' },
      endCursor: {
        type: 'string',
        description: 'Cursor to pass as `cursor` for the next page',
        nullable: true,
      },
      latestReview: {
        type: 'object',
        description: 'Newest submitted review on the pull request',
        nullable: true,
        properties: {
          state: { type: 'string', description: 'Review state' },
          submittedAt: { type: 'string', description: 'Submission timestamp' },
          authorLogin: { type: 'string', description: 'Reviewer login', nullable: true },
          authorType: {
            type: 'string',
            description: 'Reviewer GraphQL type (User, Bot)',
            nullable: true,
          },
        },
      },
    },
  }
