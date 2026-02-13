import type { JiraGetLinkTypesParams, JiraGetLinkTypesResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetLinkTypesTool: ToolConfig<JiraGetLinkTypesParams, JiraGetLinkTypesResponse> = {
  id: 'jira_get_link_types',
  name: 'Jira Get Link Types',
  description: 'Get all available issue link types (e.g., Blocks, Relates, Duplicates)',
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
    url: (params: JiraGetLinkTypesParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issueLinkType`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetLinkTypesParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetLinkTypesParams) => {
    const fetchLinkTypes = async (cloudId: string) => {
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issueLinkType`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get link types (${res.status})`
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
      data = await fetchLinkTypes(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get link types (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    const linkTypes = data.issueLinkTypes ?? []
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        total: linkTypes.length,
        linkTypes: linkTypes.map((lt: any) => ({
          id: lt.id ?? '',
          name: lt.name ?? '',
          inward: lt.inward ?? '',
          outward: lt.outward ?? '',
          self: lt.self ?? '',
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: { type: 'number', description: 'Total number of link types' },
    linkTypes: {
      type: 'array',
      description: 'Array of issue link types',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Link type ID' },
          name: { type: 'string', description: 'Link type name (e.g., Blocks, Relates)' },
          inward: { type: 'string', description: 'Inward description (e.g., is blocked by)' },
          outward: { type: 'string', description: 'Outward description (e.g., blocks)' },
          self: { type: 'string', description: 'REST API URL for this link type' },
        },
      },
    },
  },
}
