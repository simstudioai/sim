import { createLogger } from '@sim/logger'
import type { HubSpotGetEmailParams, HubSpotGetEmailResponse } from '@/tools/hubspot/types'
import { EMAIL_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetEmail')

export const hubspotGetEmailTool: ToolConfig<HubSpotGetEmailParams, HubSpotGetEmailResponse> = {
  id: 'hubspot_get_email',
  name: 'Get Email from HubSpot',
  description:
    'Retrieve a single email engagement by ID from HubSpot (content requires the sales-email-read scope)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the HubSpot API',
    },
    emailId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The HubSpot email engagement ID to retrieve',
    },
    properties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of HubSpot property names to return (e.g., "hs_email_subject,hs_email_text,hs_timestamp")',
    },
    associations: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of object types to retrieve associated IDs for (e.g., "contacts,companies,deals")',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v3/objects/emails/${params.emailId.trim()}`
      const queryParams = new URLSearchParams()

      if (params.properties) {
        queryParams.append('properties', params.properties)
      }
      if (params.associations) {
        queryParams.append('associations', params.associations)
      }

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get email from HubSpot')
    }

    return {
      success: true,
      output: {
        email: data,
        emailId: data.id,
        success: true,
      },
    }
  },

  outputs: {
    email: EMAIL_OBJECT_OUTPUT,
    emailId: { type: 'string', description: 'The retrieved email engagement ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
