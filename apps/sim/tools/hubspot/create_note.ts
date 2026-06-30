import { createLogger } from '@sim/logger'
import type { HubSpotCreateNoteParams, HubSpotCreateNoteResponse } from '@/tools/hubspot/types'
import { NOTE_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotCreateNote')

export const hubspotCreateNoteTool: ToolConfig<HubSpotCreateNoteParams, HubSpotCreateNoteResponse> =
  {
    id: 'hubspot_create_note',
    name: 'Create Note in HubSpot',
    description:
      'Log a note in HubSpot and optionally associate it with contacts, companies, or deals. Requires hs_timestamp and hs_note_body properties',
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
          'Note properties as JSON object. Must include "hs_timestamp" (ISO 8601 activity time) and "hs_note_body" (the note text). e.g., {"hs_timestamp": "2026-06-13T00:00:00Z", "hs_note_body": "Followed up via phone"}',
      },
      associations: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Array of associations as JSON. Each object has "to.id" (record ID) and "types" array with "associationCategory" ("HUBSPOT_DEFINED") and "associationTypeId" (202 = note→contact, 190 = note→company, 214 = note→deal)',
      },
    },

    request: {
      url: () => 'https://api.hubapi.com/crm/v3/objects/notes',
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
            throw new Error(
              'Invalid JSON format for properties. Please provide a valid JSON object.'
            )
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
        throw new Error(data.message || 'Failed to create note in HubSpot')
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
      noteId: { type: 'string', description: 'The created note ID' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
