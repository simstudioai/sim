import type { LinearReadIssuesParams, LinearReadIssuesResponse } from '@/tools/linear/types'
import { ISSUE_LIST_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT_PROPERTIES } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearReadIssuesTool: ToolConfig<LinearReadIssuesParams, LinearReadIssuesResponse> = {
  id: 'linear_read_issues',
  name: 'Linear Issue Reader',
  description: 'Fetch and filter issues from Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Linear team ID (UUID format) to filter issues by team',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Linear project ID (UUID format) to filter issues by project',
    },
    assigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to filter by assignee',
    },
    stateId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workflow state ID to filter by status',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority to filter by (0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low)',
    },
    labelIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of label IDs to filter by',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter issues created after this date (ISO 8601 format)',
    },
    updatedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter issues updated after this date (ISO 8601 format)',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include archived issues (default: false)',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of issues to return (default: 50, max: 250)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for next page',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: "createdAt" or "updatedAt" (default: "updatedAt")',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => {
      const filter: Record<string, any> = {}

      if (params.teamId != null && params.teamId !== '') {
        filter.team = { id: { eq: params.teamId } }
      }
      if (params.projectId != null && params.projectId !== '') {
        filter.project = { id: { eq: params.projectId } }
      }
      if (params.assigneeId != null && params.assigneeId !== '') {
        filter.assignee = { id: { eq: params.assigneeId } }
      }
      if (params.stateId != null && params.stateId !== '') {
        filter.state = { id: { eq: params.stateId } }
      }
      if (params.priority != null) {
        filter.priority = { eq: Number(params.priority) }
      }
      if (params.labelIds != null && Array.isArray(params.labelIds) && params.labelIds.length > 0) {
        filter.labels = { some: { id: { in: params.labelIds } } }
      }
      if (params.createdAfter != null && params.createdAfter !== '') {
        filter.createdAt = { gte: params.createdAfter }
      }
      if (params.updatedAfter != null && params.updatedAfter !== '') {
        filter.updatedAt = { gte: params.updatedAfter }
      }

      const variables: Record<string, any> = {}
      if (Object.keys(filter).length > 0) {
        variables.filter = filter
      }
      if (params.first != null) {
        variables.first = Math.min(Number(params.first), 250)
      }
      if (params.after != null && params.after !== '') {
        variables.after = params.after
      }
      if (params.includeArchived != null) {
        variables.includeArchived = params.includeArchived
      }
      if (params.orderBy != null) {
        variables.orderBy = params.orderBy
      }

      return {
        query: `
        query Issues(
          $filter: IssueFilter
          $first: Int
          $after: String
          $includeArchived: Boolean
          $orderBy: PaginationOrderBy
        ) {
          issues(
            filter: $filter
            first: $first
            after: $after
            includeArchived: $includeArchived
            orderBy: $orderBy
          ) {
            nodes {
              id
              title
              description
              priority
              estimate
              url
              dueDate
              createdAt
              updatedAt
              state {
                id
                name
                type
              }
              assignee {
                id
                name
                email
              }
              team {
                id
                name
              }
              project {
                id
                name
              }
              cycle {
                id
                number
                name
              }
              labels {
                nodes {
                  id
                  name
                  color
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
        variables,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to fetch issues',
        output: {},
      }
    }

    if (!data.data?.issues) {
      return {
        success: false,
        error: 'No issues data returned',
        output: {},
      }
    }

    const issues = data.data.issues.nodes || []
    const pageInfo = data.data.issues.pageInfo || {}

    return {
      success: true,
      output: {
        issues: issues.map((issue: any) => ({
          id: issue.id,
          title: issue.title,
          description: issue.description,
          priority: issue.priority,
          estimate: issue.estimate,
          url: issue.url,
          dueDate: issue.dueDate,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          state: issue.state,
          assignee: issue.assignee,
          teamId: issue.team?.id,
          teamName: issue.team?.name,
          projectId: issue.project?.id,
          projectName: issue.project?.name,
          cycleId: issue.cycle?.id,
          cycleNumber: issue.cycle?.number,
          cycleName: issue.cycle?.name,
          labels: issue.labels?.nodes || [],
        })),
        hasNextPage: pageInfo.hasNextPage,
        endCursor: pageInfo.endCursor,
      },
    }
  },

  outputs: {
    issues: {
      type: 'array',
      description: 'Array of filtered issues from Linear',
      items: {
        type: 'object',
        properties: ISSUE_LIST_OUTPUT_PROPERTIES,
      },
    },
    hasNextPage: PAGE_INFO_OUTPUT_PROPERTIES.hasNextPage,
    endCursor: PAGE_INFO_OUTPUT_PROPERTIES.endCursor,
  },
}
