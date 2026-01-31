import type { SentryUpdateIssueParams, SentryUpdateIssueResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const updateIssueTool: ToolConfig<SentryUpdateIssueParams, SentryUpdateIssueResponse> = {
  id: 'sentry_issues_update',
  name: 'Update Issue',
  description:
    'Update a Sentry issue by changing its status, assignment, bookmark state, or other properties. Returns the updated issue details.',
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
    issueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID of the issue to update (e.g., "12345")',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New status for the issue: resolved, unresolved, ignored, or resolvedInNextRelease',
    },
    assignedTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID or email to assign the issue to. Use empty string to unassign.',
    },
    isBookmarked: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to bookmark the issue',
    },
    isSubscribed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to subscribe to issue updates',
    },
    isPublic: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether the issue should be publicly visible',
    },
  },

  request: {
    url: (params) =>
      `https://sentry.io/api/0/organizations/${params.organizationSlug}/issues/${params.issueId}/`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.status !== undefined && params.status !== null && params.status !== '') {
        body.status = params.status
      }

      if (params.assignedTo !== undefined && params.assignedTo !== null) {
        body.assignedTo = params.assignedTo === '' ? null : params.assignedTo
      }

      if (params.isBookmarked !== undefined && params.isBookmarked !== null) {
        body.isBookmarked = params.isBookmarked
      }

      if (params.isSubscribed !== undefined && params.isSubscribed !== null) {
        body.isSubscribed = params.isSubscribed
      }

      if (params.isPublic !== undefined && params.isPublic !== null) {
        body.isPublic = params.isPublic
      }

      return body
    },
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
          culprit: issue.culprit ?? null,
          permalink: issue.permalink,
          logger: issue.logger ?? null,
          level: issue.level,
          status: issue.status,
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
        },
      },
    }
  },

  outputs: {
    issue: {
      type: 'object',
      description: 'The updated Sentry issue',
      properties: {
        id: { type: 'string', description: 'Unique issue ID' },
        shortId: { type: 'string', description: 'Short issue identifier' },
        title: { type: 'string', description: 'Issue title' },
        status: { type: 'string', description: 'Updated issue status' },
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
        isPublic: { type: 'boolean', description: 'Whether the issue is publicly visible' },
        permalink: { type: 'string', description: 'Direct link to the issue in Sentry' },
      },
    },
  },
}
