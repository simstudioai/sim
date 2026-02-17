import { createLogger } from '@sim/logger'
import { LinearIcon } from '@/components/icons'
import { fetchWithRetry } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'

const logger = createLogger('LinearConnector')

const LINEAR_API = 'https://api.linear.app/graphql'

/**
 * Computes a SHA-256 hash of the given content.
 */
async function computeContentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

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
  variables?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetchWithRetry(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  })

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
  query GetIssue($id: String!) {
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
function buildIssuesQuery(sourceConfig: Record<string, unknown>): {
  query: string
  variables: Record<string, unknown>
} {
  const teamId = (sourceConfig.teamId as string) || ''
  const projectId = (sourceConfig.projectId as string) || ''
  const stateFilter = (sourceConfig.stateFilter as string) || ''

  const varDefs: string[] = ['$first: Int!', '$after: String']
  const filterClauses: string[] = []
  const variables: Record<string, unknown> = {}

  if (teamId) {
    varDefs.push('$teamId: String!')
    filterClauses.push('team: { id: { eq: $teamId } }')
    variables.teamId = teamId
  }

  if (projectId) {
    varDefs.push('$projectId: String!')
    filterClauses.push('project: { id: { eq: $projectId } }')
    variables.projectId = projectId
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
  description: 'Sync issues from Linear into your knowledge base',
  version: '1.0.0',
  icon: LinearIcon,

  oauth: {
    required: true,
    provider: 'linear',
    requiredScopes: ['read'],
  },

  configFields: [
    {
      id: 'teamId',
      title: 'Team ID',
      type: 'short-input',
      placeholder: 'e.g. abc123 (leave empty for all teams)',
      required: false,
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'e.g. def456 (leave empty for all projects)',
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
    cursor?: string
  ): Promise<ExternalDocumentList> => {
    const maxIssues = sourceConfig.maxIssues ? Number(sourceConfig.maxIssues) : 0
    const pageSize = maxIssues > 0 ? Math.min(maxIssues, 50) : 50

    const { query, variables } = buildIssuesQuery(sourceConfig)
    const allVars = { ...variables, first: pageSize, after: cursor || undefined }

    logger.info('Listing Linear issues', {
      cursor,
      pageSize,
      hasTeamFilter: Boolean(sourceConfig.teamId),
      hasProjectFilter: Boolean(sourceConfig.projectId),
    })

    const data = await linearGraphQL(accessToken, query, allVars)
    const issuesConn = data.issues as Record<string, unknown>
    const nodes = (issuesConn.nodes || []) as Record<string, unknown>[]
    const pageInfo = issuesConn.pageInfo as Record<string, unknown>

    const documents: ExternalDocument[] = await Promise.all(
      nodes.map(async (issue) => {
        const content = buildIssueContent(issue)
        const contentHash = await computeContentHash(content)

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
    )

    const hasNextPage = Boolean(pageInfo.hasNextPage)
    const endCursor = (pageInfo.endCursor as string) || undefined

    return {
      documents,
      nextCursor: hasNextPage ? endCursor : undefined,
      hasMore: hasNextPage,
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
      const contentHash = await computeContentHash(content)

      const labelNodes = ((issue.labels as Record<string, unknown>)?.nodes || []) as Record<
        string,
        unknown
      >[]

      return {
        externalId: issue.id as string,
        title: `${(issue.identifier as string) || ''}: ${(issue.title as string) || 'Untitled'}`,
        content,
        mimeType: 'text/plain',
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
        error: error instanceof Error ? error.message : String(error),
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
      // Verify the token works by fetching teams
      const data = await linearGraphQL(accessToken, TEAMS_QUERY)
      const teamsConn = data.teams as Record<string, unknown>
      const teams = (teamsConn.nodes || []) as Record<string, unknown>[]

      if (teams.length === 0) {
        return {
          valid: false,
          error: 'No teams found — check that the OAuth token has read access',
        }
      }

      // If teamId specified, verify it exists
      const teamId = sourceConfig.teamId as string | undefined
      if (teamId) {
        const found = teams.some((t) => t.id === teamId)
        if (!found) {
          return {
            valid: false,
            error: `Team ID "${teamId}" not found. Available teams: ${teams.map((t) => `${t.name} (${t.id})`).join(', ')}`,
          }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
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

    const labels = Array.isArray(metadata.labels) ? (metadata.labels as string[]) : []
    if (labels.length > 0) result.labels = labels.join(', ')

    if (typeof metadata.state === 'string') result.state = metadata.state
    if (typeof metadata.priority === 'string') result.priority = metadata.priority
    if (typeof metadata.assignee === 'string') result.assignee = metadata.assignee

    if (typeof metadata.lastModified === 'string') {
      const date = new Date(metadata.lastModified)
      if (!Number.isNaN(date.getTime())) result.lastModified = date
    }

    return result
  },
}
