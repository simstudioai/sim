import { createLogger } from '@sim/logger'
import type {
  HubSpotCreateAppointmentParams,
  HubSpotCreateAppointmentResponse,
} from '@/tools/hubspot/types'
import { APPOINTMENT_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotCreateAppointment')

export const hubspotCreateAppointmentTool: ToolConfig<
  HubSpotCreateAppointmentParams,
  HubSpotCreateAppointmentResponse
> = {
  id: 'hubspot_create_appointment',
  name: 'Create Appointment in HubSpot',
  description: 'Create a new appointment in HubSpot',
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
        'Appointment properties as JSON object (e.g., {"hs_meeting_title": "Discovery Call", "hs_meeting_start_time": "2024-01-15T10:00:00Z", "hs_meeting_end_time": "2024-01-15T11:00:00Z"})',
    },
    associations: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of associations to create with the appointment as JSON. Each object should have "to.id" and "types" array with "associationCategory" and "associationTypeId"',
    },
  },

  request: {
    url: () => 'https://api.hubapi.com/crm/v3/objects/appointments',
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
      const body: Record<string, unknown> = { properties }
      if (params.associations && params.associations.length > 0) {
        body.associations = params.associations
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create appointment in HubSpot')
    }
    return {
      success: true,
      output: { appointment: data, appointmentId: data.id, success: true },
    }
  },

  outputs: {
    appointment: APPOINTMENT_OBJECT_OUTPUT,
    appointmentId: { type: 'string', description: 'The created appointment ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
