import {
  GITHUB_GRAPHQL_URL,
  githubGraphQlHeaders,
  parsePageInfo,
  readGraphQlData,
} from '@/tools/github/graphql'
import {
  isRecord,
  nullableBoolean,
  nullableNumber,
  nullableString,
  requiredNumber,
  requiredString,
} from '@/tools/github/response-parsers'
import type {
  StatusCheckRollupContext,
  StatusCheckRollupParams,
  StatusCheckRollupResponse,
} from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

const CONTEXT = 'GitHub status check rollup response'
const CONTEXTS_PER_PAGE = 100

/**
 * The merged check state for one commit, pinned by SHA rather than by branch.
 *
 * The rollup is what GitHub's own UI and `gh pr checks` read: it merges check
 * runs (Actions and most apps) with legacy commit statuses (which several
 * providers still post) server-side, and it exposes three things the REST
 * endpoints do not — `EXPECTED` for a required check that has not reported for
 * this SHA, `STARTUP_FAILURE` for an invalid workflow, and `isRequired` for the
 * pull request under consideration.
 */
const ROLLUP_QUERY = `
  query($owner: String!, $repo: String!, $sha: GitObjectID!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      object(oid: $sha) {
        __typename
        ... on Commit {
          statusCheckRollup {
            state
            contexts(first: ${CONTEXTS_PER_PAGE}, after: $cursor) {
              totalCount
              pageInfo { hasNextPage endCursor }
              nodes {
                __typename
                ... on CheckRun {
                  name
                  status
                  conclusion
                  detailsUrl
                  databaseId
                  isRequired(pullRequestNumber: $number)
                  output { title summary }
                }
                ... on StatusContext {
                  context
                  state
                  description
                  targetUrl
                  isRequired(pullRequestNumber: $number)
                }
              }
            }
          }
        }
      }
    }
  }
`

/**
 * GitHub Actions leaves the whole `output` block null on every check run it
 * creates, and populates none of its fields when it does not, so this is the
 * common case rather than the exceptional one.
 */
function parseCheckRunOutput(
  value: unknown,
  context: string
): { title: string | null; summary: string | null } | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new Error(`${context} must be an object or null`)
  return {
    title: nullableString(value, 'title', context),
    summary: nullableString(value, 'summary', context),
  }
}

function parseRollupContext(value: unknown, index: number): StatusCheckRollupContext {
  const context = `${CONTEXT}.contexts[${index}]`
  if (!isRecord(value)) throw new Error(`${context} must be an object`)

  const typename = requiredString(value, '__typename', context)
  if (typename === 'CheckRun') {
    return {
      __typename: 'CheckRun',
      name: requiredString(value, 'name', context),
      status: requiredString(value, 'status', context),
      conclusion: nullableString(value, 'conclusion', context),
      detailsUrl: nullableString(value, 'detailsUrl', context),
      databaseId: nullableNumber(value, 'databaseId', context),
      isRequired: nullableBoolean(value, 'isRequired', context),
      output: parseCheckRunOutput(value.output, `${context}.output`),
    }
  }
  if (typename === 'StatusContext') {
    return {
      __typename: 'StatusContext',
      context: requiredString(value, 'context', context),
      state: requiredString(value, 'state', context),
      description: nullableString(value, 'description', context),
      targetUrl: nullableString(value, 'targetUrl', context),
      isRequired: nullableBoolean(value, 'isRequired', context),
    }
  }
  // Stopping beats guessing: a caller buckets unknown states as blocking, and it
  // cannot do that for a shape whose fields it never received.
  throw new Error(`${context} has an unsupported type "${typename}"`)
}

/**
 * The union of both variants' fields. `OutputProperty` cannot express a
 * discriminated union, so consumers branch on `__typename` and only the fields
 * documented for that variant are present.
 */
const ROLLUP_CONTEXT_PROPERTIES = {
  __typename: { type: 'string', description: 'Either "CheckRun" or "StatusContext"' },
  name: { type: 'string', description: 'Check run name (CheckRun variant only)' },
  status: {
    type: 'string',
    description: 'Check run status (QUEUED, IN_PROGRESS, COMPLETED, WAITING, REQUESTED, PENDING)',
  },
  conclusion: {
    type: 'string',
    description: 'Conclusion once completed (SUCCESS, FAILURE, STARTUP_FAILURE, ...)',
    nullable: true,
  },
  detailsUrl: { type: 'string', description: 'Link to the check run', nullable: true },
  databaseId: {
    type: 'number',
    description: 'REST id of the check run; the Actions job id for an Actions run',
    nullable: true,
  },
  isRequired: {
    type: 'boolean',
    description: 'Whether the check is required to merge this pull request',
    nullable: true,
  },
  output: {
    type: 'object',
    description: 'Reported output; null on every GitHub Actions check run',
    nullable: true,
    properties: {
      title: { type: 'string', description: 'Output title', nullable: true },
      summary: { type: 'string', description: 'Output summary', nullable: true },
    },
  },
  context: { type: 'string', description: 'Status context name (StatusContext variant only)' },
  state: { type: 'string', description: 'Status state (StatusContext variant only)' },
  description: { type: 'string', description: 'Status description', nullable: true },
  targetUrl: { type: 'string', description: 'Status target URL', nullable: true },
} as const

export const statusCheckRollupTool: ToolConfig<StatusCheckRollupParams, StatusCheckRollupResponse> =
  {
    id: 'github_status_check_rollup',
    name: 'GitHub Status Check Rollup',
    description:
      'Read the merged check-run and commit-status state for one commit SHA, including whether each check is required to merge a given pull request.',
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
      sha: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Commit SHA to read check state for',
      },
      pullNumber: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Pull request number that decides which checks are required',
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
        description: 'GitHub API token with checks and commit statuses read access',
      },
    },

    request: {
      url: GITHUB_GRAPHQL_URL,
      method: 'POST',
      headers: (params) => githubGraphQlHeaders(params.apiKey),
      body: (params) => ({
        query: ROLLUP_QUERY,
        variables: {
          owner: params.owner,
          repo: params.repo,
          sha: params.sha,
          number: params.pullNumber,
          cursor: params.cursor ?? null,
        },
      }),
    },

    transformResponse: async (response, params) => {
      const data = await readGraphQlData(response, CONTEXT)

      const repository = data.repository
      if (!isRecord(repository)) throw new Error(`${CONTEXT}.repository was not found`)

      // A SHA GitHub does not know is not "no checks" — reporting it as an empty
      // rollup is exactly how a caller would produce a false green.
      const object = repository.object
      if (!isRecord(object)) {
        throw new Error(`Commit ${params?.sha ?? '(unknown)'} was not found in the repository`)
      }
      if (object.__typename !== 'Commit') {
        throw new Error(`${CONTEXT}.object is a ${String(object.__typename)}, not a Commit`)
      }

      const rollup = object.statusCheckRollup
      if (rollup === null || rollup === undefined) {
        return {
          success: true,
          output: { state: null, totalCount: 0, hasNextPage: false, endCursor: null, contexts: [] },
        }
      }
      if (!isRecord(rollup))
        throw new Error(`${CONTEXT}.statusCheckRollup must be an object or null`)

      const contexts = rollup.contexts
      if (!isRecord(contexts)) throw new Error(`${CONTEXT}.contexts must be an object`)
      const nodes = contexts.nodes
      if (!Array.isArray(nodes)) throw new Error(`${CONTEXT}.contexts.nodes must be an array`)

      const { hasNextPage, endCursor } = parsePageInfo(
        contexts.pageInfo,
        `${CONTEXT}.contexts.pageInfo`
      )

      return {
        success: true,
        output: {
          state: nullableString(rollup, 'state', CONTEXT),
          totalCount: requiredNumber(contexts, 'totalCount', `${CONTEXT}.contexts`),
          hasNextPage,
          endCursor,
          contexts: nodes.map(parseRollupContext),
        },
      }
    },

    outputs: {
      state: {
        type: 'string',
        description: 'Merged rollup state, or null when the commit carries no checks at all',
        nullable: true,
      },
      totalCount: { type: 'number', description: 'Total contexts on the commit across all pages' },
      hasNextPage: { type: 'boolean', description: 'Whether more context pages remain' },
      endCursor: {
        type: 'string',
        description: 'Cursor to pass as `cursor` for the next page',
        nullable: true,
      },
      contexts: {
        type: 'array',
        description: 'Check runs and legacy commit statuses, discriminated by __typename',
        items: {
          type: 'object',
          properties: ROLLUP_CONTEXT_PROPERTIES,
        },
      },
    },
  }
