import { createLogger } from '@sim/logger'
import type { HubSpotGetNoteParams, HubSpotGetNoteResponse } from '@/tools/hubspot/types'
import { NOTE_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetNote')

export const hubspotGetNoteTool: ToolConfig<HubSpotGetNoteParams, HubSpotGetNoteResponse> = {
  id: 'hubspot_get_note',
  name: 'Get Note from HubSpot',
  description: 'Retrieve a single note by ID from HubSpot',
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
    noteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The HubSpot note ID to retrieve',
    },
    properties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of HubSpot property names to return (e.g., "hs_note_body,hs_timestamp,hubspot_owner_id")',
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
      const baseUrl = `https://api.hubapi.com/crm/v3/objects/notes/${params.noteId.trim()}`
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
      throw new Error(data.message || 'Failed to get note from HubSpot')
    }

    return {
      success: true,
      output: {
        note: data,
        noteId: data.id,
        success: true,
      },
    }
  },

  outputs: {
    note: NOTE_OBJECT_OUTPUT,
    noteId: { type: 'string', description: 'The retrieved note ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
