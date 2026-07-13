import { createLogger } from '@sim/logger'
import type {
  HubSpotAddListMembershipsParams,
  HubSpotAddListMembershipsResponse,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotAddListMemberships')

export const hubspotAddListMembershipsTool: ToolConfig<
  HubSpotAddListMembershipsParams,
  HubSpotAddListMembershipsResponse
> = {
  id: 'hubspot_add_list_memberships',
  name: 'Add List Members in HubSpot',
  description: 'Add records to a manual (static) HubSpot list by record ID',
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
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the list to add records to (MANUAL or SNAPSHOT lists only)',
    },
    recordIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Record IDs to add to the list, as a JSON array (e.g., ["123","456"]) or comma-separated string',
    },
  },

  request: {
    url: (params) => `https://api.hubapi.com/crm/v3/lists/${params.listId.trim()}/memberships/add`,
    method: 'PUT',
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
      let recordIds = params.recordIds
      if (typeof recordIds === 'string') {
        const trimmed = recordIds.trim()
        if (trimmed.startsWith('[')) {
          try {
            recordIds = JSON.parse(trimmed)
          } catch (e) {
            throw new Error(`Invalid JSON for recordIds: ${(e as Error).message}`)
          }
        } else {
          recordIds = trimmed.split(',')
        }
      }
      if (!Array.isArray(recordIds)) {
        throw new Error('recordIds must be an array of record IDs')
      }
      const ids = recordIds.map((id) => String(id).trim()).filter(Boolean)
      if (ids.length === 0) {
        throw new Error('At least one record ID is required')
      }
      return ids
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to add records to HubSpot list')
    }
    return {
      success: true,
      output: {
        recordIdsAdded: data.recordIdsAdded ?? [],
        recordIdsMissing: data.recordIdsMissing ?? [],
        success: true,
      },
    }
  },

  outputs: {
    recordIdsAdded: {
      type: 'array',
      description: 'IDs of the records that were added to the list',
      items: { type: 'string' },
    },
    recordIdsMissing: {
      type: 'array',
      description: 'IDs of the requested records that were not found',
      items: { type: 'string' },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
