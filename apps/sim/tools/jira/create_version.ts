import type { JiraCreateVersionParams, JiraCreateVersionResponse } from '@/tools/jira/types'
import {
  SUCCESS_OUTPUT,
  TIMESTAMP_OUTPUT,
  VERSION_DETAIL_ITEM_PROPERTIES,
} from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraCreateVersionTool: ToolConfig<JiraCreateVersionParams, JiraCreateVersionResponse> =
  {
    id: 'jira_create_version',
    name: 'Jira Create Version',
    description: 'Create a new version/release in a Jira project',
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
        description: 'Version name (e.g., 1.0.0, Sprint 5)',
      },
      projectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Project ID to create the version in',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Version description',
      },
      startDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Start date (YYYY-MM-DD)',
      },
      releaseDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Release date (YYYY-MM-DD)',
      },
      released: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the version is released (default: false)',
      },
      archived: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the version is archived (default: false)',
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
      url: (params: JiraCreateVersionParams) => {
        if (params.cloudId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/version`
        }
        return 'https://api.atlassian.com/oauth/token/accessible-resources'
      },
      method: (params: JiraCreateVersionParams) => (params.cloudId ? 'POST' : 'GET'),
      headers: (params: JiraCreateVersionParams) => ({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }),
      body: (params: JiraCreateVersionParams) => {
        if (!params.cloudId) return undefined as any
        const body: Record<string, unknown> = {
          name: params.name,
          projectId: Number(params.projectId.trim()),
        }
        if (params.description) body.description = params.description
        if (params.startDate) body.startDate = params.startDate
        if (params.releaseDate) body.releaseDate = params.releaseDate
        if (params.released !== undefined) body.released = params.released
        if (params.archived !== undefined) body.archived = params.archived
        return body
      },
    },

    transformResponse: async (response: Response, params?: JiraCreateVersionParams) => {
      const createVersion = async (cloudId: string) => {
        const body: Record<string, unknown> = {
          name: params!.name,
          projectId: Number(params!.projectId.trim()),
        }
        if (params?.description) body.description = params.description
        if (params?.startDate) body.startDate = params.startDate
        if (params?.releaseDate) body.releaseDate = params.releaseDate
        if (params?.released !== undefined) body.released = params.released
        if (params?.archived !== undefined) body.archived = params.archived

        const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/version`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params!.accessToken}`,
          },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          let message = `Failed to create version (${res.status})`
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
        data = await createVersion(cloudId)
      } else {
        if (!response.ok) {
          let message = `Failed to create version (${response.status})`
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
          released: data.released ?? false,
          archived: data.archived ?? false,
          startDate: data.startDate ?? null,
          releaseDate: data.releaseDate ?? null,
          overdue: data.overdue ?? null,
          projectId: data.projectId ?? null,
          self: data.self ?? '',
          success: true,
        },
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      success: SUCCESS_OUTPUT,
      ...VERSION_DETAIL_ITEM_PROPERTIES,
    },
  }
