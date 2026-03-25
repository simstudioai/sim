import { createLogger } from '@sim/logger'
import type {
  HubSpotGetAppointmentParams,
  HubSpotGetAppointmentResponse,
} from '@/tools/hubspot/types'
import { APPOINTMENT_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetAppointment')

export const hubspotGetAppointmentTool: ToolConfig<
  HubSpotGetAppointmentParams,
  HubSpotGetAppointmentResponse
> = {
  id: 'hubspot_get_appointment',
  name: 'Get Appointment from HubSpot',
  description: 'Retrieve a single appointment by ID from HubSpot',
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
    appointmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The HubSpot appointment ID to retrieve',
    },
    idProperty: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Property to use as unique identifier. If not specified, uses record ID',
    },
    properties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of HubSpot property names to return (e.g., "hs_meeting_title,hs_meeting_start_time")',
    },
    associations: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of object types to retrieve associated IDs for (e.g., "contacts,companies")',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v3/objects/appointments/${params.appointmentId.trim()}`
      const queryParams = new URLSearchParams()
      if (params.idProperty) queryParams.append('idProperty', params.idProperty)
      if (params.properties) queryParams.append('properties', params.properties)
      if (params.associations) queryParams.append('associations', params.associations)
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
      throw new Error(data.message || 'Failed to get appointment from HubSpot')
    }
    return {
      success: true,
      output: { appointment: data, appointmentId: data.id, success: true },
    }
  },

  outputs: {
    appointment: APPOINTMENT_OBJECT_OUTPUT,
    appointmentId: { type: 'string', description: 'The retrieved appointment ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
