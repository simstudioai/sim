import type { LinearSearchIssuesParams, LinearSearchIssuesResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearSearchIssuesTool: ToolConfig<
  LinearSearchIssuesParams,
  LinearSearchIssuesResponse
> = {
  id: 'linear_search_issues',
  name: 'Linear Search Issues',
  description: 'Search for issues in Linear using full-text search',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query string',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by team ID',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include archived issues in search results',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default: 50)',
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
      if (params.teamId) {
        filter.team = { id: { eq: params.teamId } }
      }

      return {
        query: `
          query SearchIssues($term: String!, $filter: IssueFilter, $first: Int, $includeArchived: Boolean) {
            searchIssues(term: $term, filter: $filter, first: $first, includeArchived: $includeArchived) {
              nodes {
                id
                title
                description
                priority
                estimate
                url
                createdAt
                updatedAt
                archivedAt
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
        variables: {
          term: params.query,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          first: params.first || 50,
          includeArchived: params.includeArchived || false,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to search issues',
        output: {},
      }
    }

    const result = data.data.searchIssues
    return {
      success: true,
      output: {
        issues: result.nodes.map((issue: any) => ({
          id: issue.id,
          title: issue.title,
          description: issue.description,
          priority: issue.priority,
          estimate: issue.estimate,
          url: issue.url,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          archivedAt: issue.archivedAt,
          state: issue.state,
          assignee: issue.assignee,
          teamId: issue.team?.id,
          projectId: issue.project?.id,
          labels: issue.labels?.nodes || [],
        })),
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    issues: {
      type: 'array',
      description: 'Array of matching issues',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Issue ID' },
          title: { type: 'string', description: 'Issue title' },
          description: { type: 'string', description: 'Issue description' },
          priority: { type: 'number', description: 'Issue priority' },
          state: { type: 'object', description: 'Issue state' },
          assignee: { type: 'object', description: 'Assigned user' },
          labels: { type: 'array', description: 'Issue labels' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        hasNextPage: { type: 'boolean', description: 'Whether there are more results' },
        endCursor: { type: 'string', description: 'Cursor for next page' },
      },
    },
  },
}
