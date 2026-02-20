import type { JiraCreateComponentParams, JiraCreateComponentResponse } from '@/tools/jira/types'
import {
  COMPONENT_DETAIL_ITEM_PROPERTIES,
  SUCCESS_OUTPUT,
  TIMESTAMP_OUTPUT,
} from '@/tools/jira/types'
import { getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraCreateComponentTool: ToolConfig<
  JiraCreateComponentParams,
  JiraCreateComponentResponse
> = {
  id: 'jira_create_component',
  name: 'Jira Create Component',
  description: 'Create a new component in a Jira project',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Component name',
    },
    project: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project key (e.g., PROJ)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Component description',
    },
    leadAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account ID of the component lead',
    },
    assigneeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Default assignee type: PROJECT_DEFAULT, COMPONENT_LEAD, PROJECT_LEAD, or UNASSIGNED',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: JiraCreateComponentParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/component`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraCreateComponentParams) => (params.cloudId ? 'POST' : 'GET'),
    headers: (params: JiraCreateComponentParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: JiraCreateComponentParams) => {
      if (!params.cloudId) return undefined as any
      const body: Record<string, unknown> = {
        name: params.name,
        project: params.project.trim(),
      }
      if (params.description) body.description = params.description
      if (params.leadAccountId) body.leadAccountId = params.leadAccountId.trim()
      if (params.assigneeType) body.assigneeType = params.assigneeType
      return body
    },
  },

  transformResponse: async (response: Response, params?: JiraCreateComponentParams) => {
    const createComponent = async (cloudId: string) => {
      const body: Record<string, unknown> = {
        name: params!.name,
        project: params!.project.trim(),
      }
      if (params?.description) body.description = params.description
      if (params?.leadAccountId) body.leadAccountId = params.leadAccountId.trim()
      if (params?.assigneeType) body.assigneeType = params.assigneeType

      const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/component`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        let message = `Failed to create component (${res.status})`
        try {
          const err = await res.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      return res.json()
    }

    let data: any
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await createComponent(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to create component (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        id: data.id ?? '',
        name: data.name ?? '',
        description: data.description ?? null,
        lead: transformUser(data.lead),
        assigneeType: data.assigneeType ?? null,
        project: data.project ?? null,
        projectId: data.projectId ?? null,
        self: data.self ?? '',
        success: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    success: SUCCESS_OUTPUT,
    ...COMPONENT_DETAIL_ITEM_PROPERTIES,
  },
}
