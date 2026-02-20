import type { JiraGetResolutionsParams, JiraGetResolutionsResponse } from '@/tools/jira/types'
import { RESOLUTION_OUTPUT_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetResolutionsTool: ToolConfig<
  JiraGetResolutionsParams,
  JiraGetResolutionsResponse
> = {
  id: 'jira_get_resolutions',
  name: 'Jira Get Resolutions',
  description: 'Get all issue resolutions available in the Jira instance',
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
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: JiraGetResolutionsParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/resolution`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetResolutionsParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetResolutionsParams) => {
    const fetchResolutions = async (cloudId: string) => {
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/resolution`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get resolutions (${res.status})`
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
      data = await fetchResolutions(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get resolutions (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    const resolutions = Array.isArray(data) ? data : []
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        total: resolutions.length,
        resolutions: resolutions.map((r: any) => ({
          id: r.id ?? '',
          name: r.name ?? '',
          description: r.description ?? null,
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: { type: 'number', description: 'Total number of resolutions' },
    resolutions: {
      type: 'array',
      description: 'Array of resolutions',
      items: {
        type: 'object',
        properties: RESOLUTION_OUTPUT_PROPERTIES,
      },
    },
  },
}
