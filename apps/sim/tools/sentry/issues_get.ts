import type { SentryGetIssueParams, SentryGetIssueResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const getIssueTool: ToolConfig<SentryGetIssueParams, SentryGetIssueResponse> = {
  id: 'sentry_issues_get',
  name: 'Get Issue',
  description:
    'Retrieve detailed information about a specific Sentry issue by its ID. Returns complete issue details including metadata, tags, and statistics.',
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
      visibility: 'user-only',
      description: 'The slug of the organization',
    },
    issueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID of the issue to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://sentry.io/api/0/organizations/${params.organizationSlug}/issues/${params.issueId}/`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const issue = await response.json()

    return {
      success: true,
      output: {
        issue: {
          id: issue.id,
          shortId: issue.shortId,
          title: issue.title,
          culprit: issue.culprit,
          permalink: issue.permalink,
          logger: issue.logger,
          level: issue.level,
          status: issue.status,
          statusDetails: issue.statusDetails || {},
          isPublic: issue.isPublic,
          platform: issue.platform,
          project: {
            id: issue.project?.id || '',
            name: issue.project?.name || '',
            slug: issue.project?.slug || '',
            platform: issue.project?.platform || '',
          },
          type: issue.type,
          metadata: issue.metadata || {},
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
          subscriptionDetails: issue.subscriptionDetails,
          hasSeen: issue.hasSeen,
          annotations: issue.annotations || [],
          isUnhandled: issue.isUnhandled,
          count: issue.count,
          userCount: issue.userCount || 0,
          firstSeen: issue.firstSeen,
          lastSeen: issue.lastSeen,
          stats: issue.stats || {},
        },
      },
    }
  },

  outputs: {
    issue: {
      type: 'object',
      description: 'Detailed information about the Sentry issue',
      properties: {
        id: { type: 'string', description: 'Unique issue ID' },
        shortId: { type: 'string', description: 'Short issue identifier' },
        title: { type: 'string', description: 'Issue title' },
        culprit: { type: 'string', description: 'Function or location that caused the issue' },
        permalink: { type: 'string', description: 'Direct link to the issue in Sentry' },
        logger: { type: 'string', description: 'Logger name that reported the issue' },
        level: { type: 'string', description: 'Severity level (error, warning, info, etc.)' },
        status: { type: 'string', description: 'Current issue status' },
        statusDetails: {
          type: 'object',
          description: 'Additional details about the status',
        },
        isPublic: { type: 'boolean', description: 'Whether the issue is publicly visible' },
        platform: { type: 'string', description: 'Platform where the issue occurred' },
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
        type: { type: 'string', description: 'Issue type' },
        metadata: { type: 'object', description: 'Additional metadata about the issue' },
        numComments: { type: 'number', description: 'Number of comments on the issue' },
        assignedTo: {
          type: 'object',
          description: 'User assigned to the issue (if any)',
          properties: {
            id: { type: 'string', description: 'User ID' },
            name: { type: 'string', description: 'User name' },
            email: { type: 'string', description: 'User email' },
          },
        },
        isBookmarked: { type: 'boolean', description: 'Whether the issue is bookmarked' },
        isSubscribed: { type: 'boolean', description: 'Whether the user is subscribed to updates' },
        hasSeen: { type: 'boolean', description: 'Whether the user has seen this issue' },
        annotations: { type: 'array', description: 'Issue annotations' },
        isUnhandled: { type: 'boolean', description: 'Whether the issue is unhandled' },
        count: { type: 'string', description: 'Total number of occurrences' },
        userCount: { type: 'number', description: 'Number of unique users affected' },
        firstSeen: { type: 'string', description: 'When the issue was first seen (ISO timestamp)' },
        lastSeen: { type: 'string', description: 'When the issue was last seen (ISO timestamp)' },
        stats: { type: 'object', description: 'Statistical information about the issue' },
      },
    },
  },
}
