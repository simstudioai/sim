import type { JiraUpdateVersionParams, JiraUpdateVersionResponse } from '@/tools/jira/types'
import {
  SUCCESS_OUTPUT,
  TIMESTAMP_OUTPUT,
  VERSION_DETAIL_ITEM_PROPERTIES,
} from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraUpdateVersionTool: ToolConfig<JiraUpdateVersionParams, JiraUpdateVersionResponse> =
  {
    id: 'jira_update_version',
    name: 'Jira Update Version',
    description: 'Update an existing version/release in a Jira project',
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
      versionId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Version ID to update',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New version name',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New version description',
      },
      startDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New start date (YYYY-MM-DD)',
      },
      releaseDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New release date (YYYY-MM-DD)',
      },
      released: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the version is released',
      },
      archived: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the version is archived',
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
      url: (params: JiraUpdateVersionParams) => {
        if (params.cloudId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/version/${params.versionId.trim()}`
        }
        return 'https://api.atlassian.com/oauth/token/accessible-resources'
      },
      method: (params: JiraUpdateVersionParams) => (params.cloudId ? 'PUT' : 'GET'),
      headers: (params: JiraUpdateVersionParams) => ({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }),
      body: (params: JiraUpdateVersionParams) => {
        if (!params.cloudId) return undefined as any
        const body: Record<string, unknown> = {}
        if (params.name !== undefined) body.name = params.name
        if (params.description !== undefined) body.description = params.description
        if (params.startDate !== undefined) body.startDate = params.startDate
        if (params.releaseDate !== undefined) body.releaseDate = params.releaseDate
        if (params.released !== undefined) body.released = params.released
        if (params.archived !== undefined) body.archived = params.archived
        return body
      },
    },

    transformResponse: async (response: Response, params?: JiraUpdateVersionParams) => {
      const updateVersion = async (cloudId: string) => {
        const body: Record<string, unknown> = {}
        if (params?.name !== undefined) body.name = params.name
        if (params?.description !== undefined) body.description = params.description
        if (params?.startDate !== undefined) body.startDate = params.startDate
        if (params?.releaseDate !== undefined) body.releaseDate = params.releaseDate
        if (params?.released !== undefined) body.released = params.released
        if (params?.archived !== undefined) body.archived = params.archived

        const res = await fetch(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/version/${params!.versionId.trim()}`,
          {
            method: 'PUT',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${params!.accessToken}`,
            },
            body: JSON.stringify(body),
          }
        )
        if (!res.ok) {
          let message = `Failed to update version (${res.status})`
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
        data = await updateVersion(cloudId)
      } else {
        if (!response.ok) {
          let message = `Failed to update version (${response.status})`
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
