import type { SentryListIssuesParams, SentryListIssuesResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const listIssuesTool: ToolConfig<SentryListIssuesParams, SentryListIssuesResponse> = {
  id: 'sentry_issues_list',
  name: 'List Issues',
  description:
    'List issues from Sentry for a specific organization and optionally a specific project. Returns issue details including status, error counts, and last seen timestamps.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sentry API authentication token',
    },
    organizationSlug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The slug of the organization (e.g., "my-org")',
    },
    projectSlug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter issues by numeric project ID (e.g., "4501234"). This organization-scoped endpoint requires the numeric project ID, not the project slug.',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query to filter issues. Supports Sentry search syntax (e.g., "is:unresolved", "level:error")',
    },
    statsPeriod: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Time window for the per-issue stats series (e.g., "24h", "14d"). Note: this controls the stats returned with each issue, not which issues are returned — use the query (e.g., "age:-7d", "lastSeen:-24h") to filter results.',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for retrieving next page of results',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of issues to return per page (max: 100)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Filter by issue status: unresolved, resolved, or ignored. The legacy "ignored"/"muted" values map to Sentry\'s current "archived" search token.',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort order: date, new, trends, freq, or user (default: date)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://sentry.io/api/0/organizations/${params.organizationSlug}/issues/`
      const queryParams: string[] = []

      if (params.projectSlug && params.projectSlug !== null && params.projectSlug !== '') {
        queryParams.push(`project=${encodeURIComponent(params.projectSlug)}`)
      }

      let searchQuery = params.query && params.query !== null ? params.query.trim() : ''
      if (params.status && params.status !== null && params.status !== '') {
        const statusToken =
          params.status === 'ignored' || params.status === 'muted' ? 'archived' : params.status
        searchQuery = searchQuery ? `${searchQuery} is:${statusToken}` : `is:${statusToken}`
      }
      queryParams.push(`query=${encodeURIComponent(searchQuery)}`)

      if (params.statsPeriod && params.statsPeriod !== null && params.statsPeriod !== '') {
        queryParams.push(`statsPeriod=${encodeURIComponent(params.statsPeriod)}`)
      }

      if (params.cursor && params.cursor !== null && params.cursor !== '') {
        queryParams.push(`cursor=${encodeURIComponent(params.cursor)}`)
      }

      if (params.limit && params.limit !== null) {
        queryParams.push(`limit=${Number(params.limit)}`)
      }

      if (params.sort && params.sort !== null && params.sort !== '') {
        const sortValue = params.sort === 'priority' ? 'trends' : params.sort
        queryParams.push(`sort=${encodeURIComponent(sortValue)}`)
      }

      return queryParams.length > 0 ? `${baseUrl}?${queryParams.join('&')}` : baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const linkHeader = response.headers.get('Link')
    let nextCursor: string | undefined
    let hasMore = false

    if (linkHeader) {
      const nextMatch = linkHeader.match(
        /<[^>]*cursor=([^&>]+)[^>]*>;\s*rel="next";\s*results="true"/
      )
      if (nextMatch) {
        nextCursor = decodeURIComponent(nextMatch[1])
        hasMore = true
      }
    }

    const issues = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        issues: issues.map((issue: any) => ({
          id: issue.id,
          shortId: issue.shortId,
          title: issue.title,
          culprit: issue.culprit ?? null,
          permalink: issue.permalink,
          logger: issue.logger ?? null,
          level: issue.level,
          status: issue.status,
          substatus: issue.substatus ?? null,
          priority: issue.priority ?? null,
          statusDetails: issue.statusDetails || {},
          isPublic: issue.isPublic,
          platform: issue.platform ?? null,
          project: {
            id: issue.project?.id || '',
            name: issue.project?.name || '',
            slug: issue.project?.slug || '',
            platform: issue.project?.platform || '',
          },
          type: issue.type ?? null,
          metadata: {
            type: issue.metadata?.type || null,
            value: issue.metadata?.value || null,
            function: issue.metadata?.function || null,
          },
          numComments: issue.numComments || 0,
          assignedTo: issue.assignedTo
            ? {
                id: issue.assignedTo.id,
                name: issue.assignedTo.name,
                email: issue.assignedTo.email,
              }
            : null,
          isBookmarked: issue.isBookmarked,
          isSubscribed: issue.isSubscribed,
          subscriptionDetails: issue.subscriptionDetails ?? null,
          hasSeen: issue.hasSeen,
          annotations: issue.annotations || [],
          isUnhandled: issue.isUnhandled,
          count: issue.count,
          userCount: issue.userCount || 0,
          firstSeen: issue.firstSeen,
          lastSeen: issue.lastSeen,
          stats: issue.stats || {},
        })),
        metadata: {
          nextCursor,
          hasMore,
        },
      },
    }
  },

  outputs: {
    issues: {
      type: 'array',
      description: 'List of Sentry issues',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique issue ID' },
          shortId: { type: 'string', description: 'Short issue identifier' },
          title: { type: 'string', description: 'Issue title' },
          culprit: {
            type: 'string',
            description: 'Function or location that caused the issue',
            optional: true,
          },
          permalink: { type: 'string', description: 'Direct link to the issue in Sentry' },
          logger: {
            type: 'string',
            description: 'Logger name that reported the issue',
            optional: true,
          },
          level: { type: 'string', description: 'Severity level (error, warning, info, etc.)' },
          status: { type: 'string', description: 'Current issue status' },
          substatus: {
            type: 'string',
            description:
              'Issue substatus (e.g., ongoing, escalating, new, archived_until_escalating)',
            optional: true,
          },
          priority: {
            type: 'string',
            description: 'Issue priority (high, medium, or low)',
            optional: true,
          },
          statusDetails: { type: 'object', description: 'Additional details about the status' },
          isPublic: { type: 'boolean', description: 'Whether the issue is publicly visible' },
          platform: {
            type: 'string',
            description: 'Platform where the issue occurred',
            optional: true,
          },
          project: {
            type: 'object',
            description: 'Project information',
            properties: {
              id: { type: 'string', description: 'Project ID' },
              name: { type: 'string', description: 'Project name' },
              slug: { type: 'string', description: 'Project slug' },
              platform: { type: 'string', description: 'Project platform' },
            },
          },
          type: { type: 'string', description: 'Issue type', optional: true },
          metadata: {
            type: 'object',
            description: 'Error metadata',
            properties: {
              type: { type: 'string', description: 'Type of error (e.g., TypeError)' },
              value: { type: 'string', description: 'Error message or value' },
              function: { type: 'string', description: 'Function where the error occurred' },
            },
          },
          numComments: { type: 'number', description: 'Number of comments on the issue' },
          assignedTo: {
            type: 'object',
            description: 'User assigned to the issue',
            properties: {
              id: { type: 'string', description: 'User ID' },
              name: { type: 'string', description: 'User name' },
              email: { type: 'string', description: 'User email' },
            },
          },
          isBookmarked: { type: 'boolean', description: 'Whether the issue is bookmarked' },
          isSubscribed: { type: 'boolean', description: 'Whether subscribed to updates' },
          hasSeen: { type: 'boolean', description: 'Whether the user has seen this issue' },
          annotations: { type: 'array', description: 'Issue annotations' },
          isUnhandled: { type: 'boolean', description: 'Whether the issue is unhandled' },
          count: { type: 'string', description: 'Total number of occurrences' },
          userCount: { type: 'number', description: 'Number of unique users affected' },
          firstSeen: {
            type: 'string',
            description: 'When the issue was first seen (ISO timestamp)',
          },
          lastSeen: { type: 'string', description: 'When the issue was last seen (ISO timestamp)' },
          stats: { type: 'object', description: 'Statistical information about the issue' },
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Pagination metadata',
      properties: {
        nextCursor: {
          type: 'string',
          description: 'Cursor for the next page of results (if available)',
        },
        hasMore: {
          type: 'boolean',
          description: 'Whether there are more results available',
        },
      },
    },
  },
}
