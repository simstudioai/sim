import type { JiraGetFieldsParams, JiraGetFieldsResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetFieldsTool: ToolConfig<JiraGetFieldsParams, JiraGetFieldsResponse> = {
  id: 'jira_get_fields',
  name: 'Jira Get Fields',
  description: 'Get all fields (system and custom) available in the Jira instance',
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
    url: (params: JiraGetFieldsParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/field`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetFieldsParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetFieldsParams) => {
    const fetchFields = async (cloudId: string) => {
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/field`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get fields (${res.status})`
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
      data = await fetchFields(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get fields (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    const fields = Array.isArray(data) ? data : []
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        total: fields.length,
        fields: fields.map((f: any) => ({
          id: f.id ?? '',
          key: f.key ?? f.id ?? '',
          name: f.name ?? '',
          custom: f.custom ?? false,
          orderable: f.orderable ?? false,
          navigable: f.navigable ?? false,
          searchable: f.searchable ?? false,
          clauseNames: f.clauseNames ?? [],
          schema: f.schema
            ? {
                type: f.schema.type ?? '',
                system: f.schema.system ?? null,
                custom: f.schema.custom ?? null,
                customId: f.schema.customId ?? null,
              }
            : null,
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: { type: 'number', description: 'Total number of fields' },
    fields: {
      type: 'array',
      description: 'Array of fields',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Field ID (e.g., summary, customfield_10001)' },
          key: { type: 'string', description: 'Field key' },
          name: { type: 'string', description: 'Field name' },
          custom: { type: 'boolean', description: 'Whether this is a custom field' },
          orderable: { type: 'boolean', description: 'Whether the field is orderable' },
          navigable: { type: 'boolean', description: 'Whether the field is navigable' },
          searchable: { type: 'boolean', description: 'Whether the field is searchable' },
          clauseNames: {
            type: 'array',
            description: 'JQL clause names for this field',
            items: { type: 'string' },
          },
          schema: {
            type: 'object',
            description: 'Field schema information',
            properties: {
              type: { type: 'string', description: 'Field type' },
              system: { type: 'string', description: 'System field name', optional: true },
              custom: { type: 'string', description: 'Custom field type', optional: true },
              customId: { type: 'number', description: 'Custom field ID', optional: true },
            },
            optional: true,
          },
        },
      },
    },
  },
}
