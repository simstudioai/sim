import type { JiraCreateSprintParams, JiraCreateSprintResponse } from '@/tools/jira/types'
import type { InternalToolConfig } from '@/tools/types'

export const jiraCreateSprintTool: InternalToolConfig<
  JiraCreateSprintParams,
  JiraCreateSprintResponse
> = {
  id: 'jira_create_sprint',
  name: 'Jira Create Sprint',
  description: 'Create a future sprint on a Jira Software board',
  version: '1.0.0',
  assistant: {
    effect: 'write',
    version: 1,
    reviewFields: [
      { name: 'domain', label: 'Jira site', target: true },
      { name: 'originBoardId', label: 'Board', target: true },
      { name: 'name', label: 'Sprint name', editable: true },
      { name: 'goal', label: 'Goal', format: 'multiline', editable: true },
      { name: 'startDate', label: 'Start date', editable: true },
      { name: 'endDate', label: 'End date', editable: true },
    ],
  },
  oauth: { required: true, provider: 'jira', requiredScopes: ['write:sprint:jira-software'] },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Jira OAuth access token',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira site domain, such as yourcompany.atlassian.net',
    },
    originBoardId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Numeric ID of the Jira Software board that owns the sprint',
    },
    name: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Sprint name' },
    goal: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sprint goal',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned start as an ISO 8601 timestamp with timezone',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned end as an ISO 8601 timestamp with timezone',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      domain: params.domain,
      originBoardId: params.originBoardId,
      name: params.name,
      goal: params.goal,
      startDate: params.startDate || undefined,
      endDate: params.endDate || undefined,
    }),
  },
  outputs: {
    warning: {
      type: 'string',
      description: 'Creation succeeded but sprint details are unavailable',
      optional: true,
    },
    sprint: {
      optional: true,
      type: 'json',
      description:
        'Created sprint with id, self, state, name, originBoardId, and optional goal, startDate, endDate',
      properties: {
        id: { type: 'number', description: 'Sprint ID' },
        self: { type: 'string', description: 'Sprint REST URL' },
        state: { type: 'string', description: 'Initial state: future' },
        name: { type: 'string', description: 'Sprint name' },
        originBoardId: { type: 'number', description: 'Origin board ID' },
        goal: { type: 'string', description: 'Sprint goal', optional: true },
        startDate: { type: 'string', description: 'Planned start timestamp', optional: true },
        endDate: { type: 'string', description: 'Planned end timestamp', optional: true },
      },
    },
  },
}
