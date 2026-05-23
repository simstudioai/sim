import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { LinearIcon } from '@/components/icons'
import type { RetryOptions } from '@/lib/knowledge/documents/utils'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseMultiValue, parseTagDate } from '@/connectors/utils'

const logger = createLogger('LinearConnector')

const LINEAR_API = 'https://api.linear.app/graphql'

/**
 * Strips Markdown formatting to produce plain text.
 */
function markdownToPlainText(md: string): string {
  let text = md
    .replace(/!\[.*?\]\(.*?\)/g, '') // images
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1') // links
    .replace(/#{1,6}\s+/g, '') // headings
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/~~(.*?)~~/g, '$1') // strikethrough
    .replace(/`{3}[\s\S]*?`{3}/g, '') // code blocks
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/^\s*[-*+]\s+/gm, '') // list items
    .replace(/^\s*\d+\.\s+/gm, '') // ordered list items
    .replace(/^\s*>\s+/gm, '') // blockquotes
    .replace(/---+/g, '') // horizontal rules
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

/**
 * Executes a GraphQL query against the Linear API.
 */
async function linearGraphQL(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
  retryOptions?: RetryOptions
): Promise<Record<string, unknown>> {
  const response = await fetchWithRetry(
    LINEAR_API,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    },
    retryOptions
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Linear GraphQL request failed', { status: response.status, error: errorText })
    throw new Error(`Linear API error: ${response.status}`)
  }

  const json = (await response.json()) as { data?: Record<string, unknown>; errors?: unknown[] }
  if (json.errors) {
    logger.error('Linear GraphQL errors', { errors: json.errors })
    throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`)
  }

  return json.data as Record<string, unknown>
}

/**
 * Builds a formatted text document from a Linear issue.
 */
function buildIssueContent(issue: Record<string, unknown>): string {
  const parts: string[] = []

  const identifier = issue.identifier as string | undefined
  const title = (issue.title as string) || 'Untitled'
  parts.push(`${identifier ? `${identifier}: ` : ''}${title}`)

  const state = issue.state as Record<string, unknown> | undefined
  if (state?.name) parts.push(`Status: ${state.name}`)

  const priority = issue.priorityLabel as string | undefined
  if (priority) parts.push(`Priority: ${priority}`)

  const assignee = issue.assignee as Record<string, unknown> | undefined
  if (assignee?.name) parts.push(`Assignee: ${assignee.name}`)

  const labelsConn = issue.labels as Record<string, unknown> | undefined
  const labelNodes = (labelsConn?.nodes || []) as Record<string, unknown>[]
  if (labelNodes.length > 0) {
    parts.push(`Labels: ${labelNodes.map((l) => l.name as string).join(', ')}`)
  }

  const description = issue.description as string | undefined
  if (description) {
    parts.push('')
    parts.push(markdownToPlainText(description))
  }

  return parts.join('\n')
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  priorityLabel
  url
  createdAt
  updatedAt
  state { name }
  assignee { name }
  labels { nodes { name } }
  team { name key }
  project { name }
`

const ISSUE_BY_ID_QUERY = `
  query GetIssue($id: ID!) {
    issue(id: $id) {
      ${ISSUE_FIELDS}
    }
  }
`

const TEAMS_QUERY = `
  query { teams { nodes { id name key } } }
`

/**
 * Dynamically builds a GraphQL issues query with only the filter clauses
 * that have values, preventing null comparators from being sent to Linear.
 */
function buildIssuesQuery(
  sourceConfig: Record<string, unknown>,
  teamIds: string[],
  projectIds: string[]
): {
  query: string
  variables: Record<string, unknown>
} {
  const stateFilter = (sourceConfig.stateFilter as string) || ''

  const varDefs: string[] = ['$first: Int!', '$after: String']
  const filterClauses: string[] = []
  const variables: Record<string, unknown> = {}

  if (teamIds.length === 1) {
    varDefs.push('$teamId: ID!')
    filterClauses.push('team: { id: { eq: $teamId } }')
    variables.teamId = teamIds[0]
  } else if (teamIds.length > 1) {
    varDefs.push('$teamIds: [ID!]!')
    filterClauses.push('team: { id: { in: $teamIds } }')
    variables.teamIds = teamIds
  }

  if (projectIds.length === 1) {
    varDefs.push('$projectId: ID!')
    filterClauses.push('project: { id: { eq: $projectId } }')
    variables.projectId = projectIds[0]
  } else if (projectIds.length > 1) {
    varDefs.push('$projectIds: [ID!]!')
    filterClauses.push('project: { id: { in: $projectIds } }')
    variables.projectIds = projectIds
  }

  if (stateFilter) {
    const states = stateFilter
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (states.length > 0) {
      varDefs.push('$stateFilter: [String!]!')
      filterClauses.push('state: { name: { in: $stateFilter } }')
      variables.stateFilter = states
    }
  }

  const filterArg = filterClauses.length > 0 ? `, filter: { ${filterClauses.join(', ')} }` : ''

  const query = `
    query ListIssues(${varDefs.join(', ')}) {
      issues(first: $first, after: $after${filterArg}) {
        nodes {
          ${ISSUE_FIELDS}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `

  return { query, variables }
}

export const linearConnector: ConnectorConfig = {
  id: 'linear',
  name: 'Linear',
  description: 'Sync issues from Linear',
  version: '1.0.0',
  icon: LinearIcon,

  auth: { mode: 'oauth', provider: 'linear', requiredScopes: ['read'] },

  configFields: [
    {
      id: 'teamSelector',
      title: 'Teams',
      type: 'selector',
      selectorKey: 'linear.teams',
      canonicalParamId: 'teamId',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more teams (optional)',
      required: false,
    },
    {
      id: 'teamId',
      title: 'Team IDs',
      type: 'short-input',
      canonicalParamId: 'teamId',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. abc123, def456 (comma-separated for multiple)',
      required: false,
    },
    {
      id: 'projectSelector',
      title: 'Projects',
      type: 'selector',
      selectorKey: 'linear.projects',
      canonicalParamId: 'projectId',
      mode: 'basic',
      multi: true,
      dependsOn: ['teamSelector'],
      placeholder: 'Select one or more projects (optional)',
      required: false,
    },
    {
      id: 'projectId',
      title: 'Project IDs',
      type: 'short-input',
      canonicalParamId: 'projectId',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. def456, ghi789 (comma-separated for multiple)',
      required: false,
    },
    {
      id: 'stateFilter',
      title: 'State Filter',
      type: 'short-input',
      placeholder: 'e.g. In Progress, Todo',
      required: false,
    },
    {
      id: 'maxIssues',
      title: 'Max Issues',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxIssues = sourceConfig.maxIssues ? Number(sourceConfig.maxIssues) : 0
    const pageSize = maxIssues > 0 ? Math.min(maxIssues, 50) : 50

    const teamIds = parseMultiValue(sourceConfig.teamId)
    const projectIds = parseMultiValue(sourceConfig.projectId)

    const { query, variables } = buildIssuesQuery(sourceConfig, teamIds, projectIds)
    const allVars = { ...variables, first: pageSize, after: cursor || undefined }

    logger.info('Listing Linear issues', {
      cursor,
      pageSize,
      teamFilterCount: teamIds.length,
      projectFilterCount: projectIds.length,
    })

    const data = await linearGraphQL(accessToken, query, allVars)
    const issuesConn = data.issues as Record<string, unknown>
    const nodes = (issuesConn.nodes || []) as Record<string, unknown>[]
    const pageInfo = issuesConn.pageInfo as Record<string, unknown>

    const documents: ExternalDocument[] = nodes.map((issue) => {
      const content = buildIssueContent(issue)
      const contentHash = `linear:${issue.id}:${issue.updatedAt}`

      const labelNodes = ((issue.labels as Record<string, unknown>)?.nodes || []) as Record<
        string,
        unknown
      >[]

      return {
        externalId: issue.id as string,
        title: `${(issue.identifier as string) || ''}: ${(issue.title as string) || 'Untitled'}`,
        content,
        mimeType: 'text/plain' as const,
        sourceUrl: (issue.url as string) || undefined,
        contentHash,
        metadata: {
          identifier: issue.identifier,
          state: (issue.state as Record<string, unknown>)?.name,
          priority: issue.priorityLabel,
          assignee: (issue.assignee as Record<string, unknown>)?.name,
          labels: labelNodes.map((l) => l.name as string),
          team: (issue.team as Record<string, unknown>)?.name,
          project: (issue.project as Record<string, unknown>)?.name,
          lastModified: issue.updatedAt,
        },
      }
    })

    const hasNextPage = Boolean(pageInfo.hasNextPage)
    const endCursor = (pageInfo.endCursor as string) || undefined

    const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxIssues > 0 && totalFetched >= maxIssues

    return {
      documents,
      nextCursor: hasNextPage && !hitLimit ? endCursor : undefined,
      hasMore: hasNextPage && !hitLimit,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      const data = await linearGraphQL(accessToken, ISSUE_BY_ID_QUERY, { id: externalId })
      const issue = data.issue as Record<string, unknown> | null

      if (!issue) return null

      const content = buildIssueContent(issue)
      const contentHash = `linear:${issue.id}:${issue.updatedAt}`

      const labelNodes = ((issue.labels as Record<string, unknown>)?.nodes || []) as Record<
        string,
        unknown
      >[]

      return {
        externalId: issue.id as string,
        title: `${(issue.identifier as string) || ''}: ${(issue.title as string) || 'Untitled'}`,
        content,
        mimeType: 'text/plain' as const,
        sourceUrl: (issue.url as string) || undefined,
        contentHash,
        metadata: {
          identifier: issue.identifier,
          state: (issue.state as Record<string, unknown>)?.name,
          priority: issue.priorityLabel,
          assignee: (issue.assignee as Record<string, unknown>)?.name,
          labels: labelNodes.map((l) => l.name as string),
          team: (issue.team as Record<string, unknown>)?.name,
          project: (issue.project as Record<string, unknown>)?.name,
          lastModified: issue.updatedAt,
        },
      }
    } catch (error) {
      logger.error('Failed to get Linear issue', {
        externalId,
        error: toError(error).message,
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxIssues = sourceConfig.maxIssues as string | undefined
    if (maxIssues && (Number.isNaN(Number(maxIssues)) || Number(maxIssues) <= 0)) {
      return { valid: false, error: 'Max issues must be a positive number' }
    }

    try {
      const data = await linearGraphQL(accessToken, TEAMS_QUERY, undefined, VALIDATE_RETRY_OPTIONS)
      const teamsConn = data.teams as Record<string, unknown>
      const teams = (teamsConn.nodes || []) as Record<string, unknown>[]

      if (teams.length === 0) {
        return {
          valid: false,
          error: 'No teams found — check that the OAuth token has read access',
        }
      }

      const requestedTeamIds = parseMultiValue(sourceConfig.teamId)
      if (requestedTeamIds.length > 0) {
        const availableIds = new Set(teams.map((t) => t.id as string))
        const missing = requestedTeamIds.filter((id) => !availableIds.has(id))
        if (missing.length > 0) {
          return {
            valid: false,
            error: `Team ID(s) not found: ${missing.join(', ')}. Available teams: ${teams.map((t) => `${t.name} (${t.id})`).join(', ')}`,
          }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    { id: 'assignee', displayName: 'Assignee', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const labels = joinTagArray(metadata.labels)
    if (labels) result.labels = labels

    if (typeof metadata.state === 'string') result.state = metadata.state
    if (typeof metadata.priority === 'string') result.priority = metadata.priority
    if (typeof metadata.assignee === 'string') result.assignee = metadata.assignee

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}
