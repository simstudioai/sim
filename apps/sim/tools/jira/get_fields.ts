import type { JiraGetFieldsParams, JiraGetFieldsResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

function buildFieldsUrl(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/field`
}

export const jiraGetFieldsTool: ToolConfig<JiraGetFieldsParams, JiraGetFieldsResponse> = {
  id: 'jira_get_fields',
  name: 'Jira Get Fields',
  description:
    'Get all system and custom fields defined in the Jira instance. Useful for discovering custom field IDs (e.g., customfield_10001) to use when writing or updating issues.',
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
        return buildFieldsUrl(params.cloudId)
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
      const fieldsResponse = await fetch(buildFieldsUrl(cloudId), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!fieldsResponse.ok) {
        const errorText = await fieldsResponse.text()
        throw new Error(
          parseAtlassianErrorMessage(fieldsResponse.status, fieldsResponse.statusText, errorText)
        )
      }

      return fieldsResponse.json()
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchFields(cloudId)
    } else {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(parseAtlassianErrorMessage(response.status, response.statusText, errorText))
      }
      data = await response.json()
    }

    const fields = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        fields: fields.map((f: any) => ({
          id: f?.id ?? '',
          key: f?.key ?? null,
          name: f?.name ?? '',
          custom: f?.custom ?? null,
          navigable: f?.navigable ?? null,
          searchable: f?.searchable ?? null,
          schemaType: f?.schema?.type ?? null,
          customType: f?.schema?.custom ?? null,
        })),
        total: fields.length,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    fields: {
      type: 'array',
      description: 'Array of Jira fields (system and custom)',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Field ID (e.g., summary, customfield_10001)' },
          key: { type: 'string', description: 'Field key', optional: true },
          name: { type: 'string', description: 'Human-readable field name' },
          custom: {
            type: 'boolean',
            description: 'Whether this is a custom field',
            optional: true,
          },
          navigable: {
            type: 'boolean',
            description: 'Whether the field is navigable in issue views',
            optional: true,
          },
          searchable: {
            type: 'boolean',
            description: 'Whether the field can be used in JQL searches',
            optional: true,
          },
          schemaType: {
            type: 'string',
            description: 'Field value type (e.g., string, number, array, user)',
            optional: true,
          },
          customType: {
            type: 'string',
            description: 'Custom field type identifier (only for custom fields)',
            optional: true,
          },
        },
      },
    },
    total: { type: 'number', description: 'Number of fields returned' },
  },
}
