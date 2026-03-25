import { createLogger } from '@sim/logger'
import type {
  HubSpotUpdateAppointmentParams,
  HubSpotUpdateAppointmentResponse,
} from '@/tools/hubspot/types'
import { APPOINTMENT_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotUpdateAppointment')

export const hubspotUpdateAppointmentTool: ToolConfig<
  HubSpotUpdateAppointmentParams,
  HubSpotUpdateAppointmentResponse
> = {
  id: 'hubspot_update_appointment',
  name: 'Update Appointment in HubSpot',
  description: 'Update an existing appointment in HubSpot by ID',
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
      description: 'The HubSpot appointment ID to update',
    },
    idProperty: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Property to use as unique identifier. If not specified, uses record ID',
    },
    properties: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Appointment properties to update as JSON object (e.g., {"hs_meeting_title": "Updated Call", "hs_meeting_location": "Zoom"})',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v3/objects/appointments/${params.appointmentId.trim()}`
      const queryParams = new URLSearchParams()
      if (params.idProperty) queryParams.append('idProperty', params.idProperty)
      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'PATCH',
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
      return { properties }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to update appointment in HubSpot')
    }
    return {
      success: true,
      output: { appointment: data, appointmentId: data.id, success: true },
    }
  },

  outputs: {
    appointment: APPOINTMENT_OBJECT_OUTPUT,
    appointmentId: { type: 'string', description: 'The updated appointment ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
