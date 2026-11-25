import { githubRepoPath } from '@/tools/github/request-path'
import type { CreateIssueParams, IssueResponse } from '@/tools/github/types'
import {
  ISSUE_OUTPUT_PROPERTIES,
  LABEL_OUTPUT,
  MILESTONE_OUTPUT,
  USER_OUTPUT,
} from '@/tools/github/types'
import { GITHUB_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

/** A comma-separated `assignees` or `labels` param as the names the request sends. */
function nameList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

/** The issue fields a create request sends: its title, and the body, labels and assignees it sets. */
function requestedIssue(params: CreateIssueParams) {
  const labels = nameList(params.labels)
  const assignees = nameList(params.assignees)
  return {
    title: params.title,
    ...(params.body ? { body: params.body } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(assignees.length > 0 ? { assignees } : {}),
  }
}

export const createIssueTool: ToolConfig<CreateIssueParams, IssueResponse> = {
  id: 'github_create_issue',
  name: 'GitHub Create Issue',
  description: 'Create a new issue in a GitHub repository',
  version: '1.0.0',
  effect: 'write',
  oauth: GITHUB_CREDENTIAL_OAUTH,

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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue title',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Issue description/body',
    },
    assignees: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of usernames to assign to this issue',
    },
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of label names to add to this issue',
    },
    milestone: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Milestone number to associate with this issue',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${githubRepoPath(params.owner, params.repo)}/issues`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => ({
      ...requestedIssue(params),
      ...(params.milestone ? { milestone: params.milestone } : {}),
    }),
  },

  /**
   * A dry run's placeholder holds what the call sets on the issue it creates; its number, state,
   * URL and times stay placeholders.
   */
  dryRunOutput: (params) => ({ metadata: requestedIssue(params) }),

  transformResponse: async (response) => {
    const issue = await response.json()

    const labels = issue.labels?.map((label: any) => label.name) || []

    const assignees = issue.assignees?.map((assignee: any) => assignee.login) || []

    const content = `Issue #${issue.number} created: "${issue.title}"
State: ${issue.state}
URL: ${issue.html_url}
${labels.length > 0 ? `Labels: ${labels.join(', ')}` : ''}
${assignees.length > 0 ? `Assignees: ${assignees.join(', ')}` : ''}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          html_url: issue.html_url,
          labels,
          assignees,
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          body: issue.body,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable issue creation confirmation' },
    metadata: {
      type: 'object',
      description: 'Issue metadata',
      properties: {
        number: { type: 'number', description: 'Issue number' },
        title: { type: 'string', description: 'Issue title' },
        state: { type: 'string', description: 'Issue state (open/closed)' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        labels: { type: 'array', description: 'Array of label names' },
        assignees: { type: 'array', description: 'Array of assignee usernames' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        body: { type: 'string', description: 'Issue body/description' },
      },
    },
  },
}

export const createIssueV2Tool: ToolConfig<CreateIssueParams, any> = {
  id: 'github_create_issue_v2',
  name: createIssueTool.name,
  description: createIssueTool.description,
  version: '2.0.0',
  effect: 'write',
  oauth: GITHUB_CREDENTIAL_OAUTH,
  params: createIssueTool.params,
  request: createIssueTool.request,

  /**
   * A dry run's placeholder holds what the call sets on the issue it creates, each label and
   * assignee by the name it sends and the milestone by its number (null when none is set); its
   * id, number, state, URL and times stay placeholders.
   */
  dryRunOutput: (params) => {
    const { labels, assignees, ...issue } = requestedIssue(params)
    return {
      ...issue,
      ...(labels ? { labels: labels.map((name) => ({ name })) } : {}),
      ...(assignees ? { assignees: assignees.map((login) => ({ login })) } : {}),
      milestone: params.milestone ? { number: params.milestone } : null,
    }
  },

  transformResponse: async (response: Response) => {
    const issue = await response.json()
    return {
      success: true,
      output: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        html_url: issue.html_url,
        body: issue.body ?? null,
        user: issue.user,
        labels: issue.labels ?? [],
        assignees: issue.assignees ?? [],
        milestone: issue.milestone ?? null,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at ?? null,
      },
    }
  },

  outputs: {
    ...ISSUE_OUTPUT_PROPERTIES,
    user: USER_OUTPUT,
    labels: {
      type: 'array',
      description: 'Array of label objects',
      items: LABEL_OUTPUT,
    },
    assignees: {
      type: 'array',
      description: 'Array of assignee objects',
      items: USER_OUTPUT,
    },
    milestone: { ...MILESTONE_OUTPUT, optional: true },
  },
}
