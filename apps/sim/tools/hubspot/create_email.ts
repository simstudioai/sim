import { createLogger } from '@sim/logger'
import type { HubSpotCreateEmailParams, HubSpotCreateEmailResponse } from '@/tools/hubspot/types'
import { EMAIL_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotCreateEmail')

export const hubspotCreateEmailTool: ToolConfig<
  HubSpotCreateEmailParams,
  HubSpotCreateEmailResponse
> = {
  id: 'hubspot_create_email',
  name: 'Create Email in HubSpot',
  description:
    'Log an email engagement in HubSpot and optionally associate it with contacts. Requires the hs_timestamp property',
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
    properties: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Email properties as JSON object. Must include "hs_timestamp" (ISO 8601). Common fields: "hs_email_direction" (EMAIL, INCOMING_EMAIL, FORWARDED_EMAIL), "hs_email_status" (SENT, SENDING, SCHEDULED, FAILED, BOUNCED), "hs_email_subject", "hs_email_text", "hs_email_html", "hs_email_headers" (JSON string)',
    },
    associations: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of associations as JSON. Each object has "to.id" (record ID) and "types" array with "associationCategory" ("HUBSPOT_DEFINED") and "associationTypeId" (198 = email→contact)',
    },
  },

  request: {
    url: () => 'https://api.hubapi.com/crm/v3/objects/emails',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      let properties = params.properties
      if (typeof properties === 'string') {
        try {
          properties = JSON.parse(properties)
        } catch (e) {
          throw new Error('Invalid JSON format for properties. Please provide a valid JSON object.')
        }
      }

      const body: Record<string, unknown> = {
        properties,
      }

      let associations = params.associations
      if (typeof associations === 'string') {
        try {
          associations = JSON.parse(associations)
        } catch (e) {
          throw new Error(
            'Invalid JSON format for associations. Please provide a valid JSON array.'
          )
        }
      }
      if (Array.isArray(associations) && associations.length > 0) {
        body.associations = associations
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create email in HubSpot')
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
    emailId: { type: 'string', description: 'The created email engagement ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
