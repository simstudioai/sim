import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookEntityPeopleTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_entity_people',
  name: 'PitchBook Entity People',
  description:
    'Retrieve the people at an entity: primary contact, current and former team, and current and former board members',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    pbId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'PitchBook entity ID of a company, investor, or service provider, e.g. 51261-67.',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
    },
  },

  request: {
    url: (params) => `${PITCHBOOK_API_BASE}/entities/${params.pbId.trim()}/people`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch entity people')
    const data = await response.json()

    return {
      success: true,
      output: {
        entityId: data.entityId ?? null,
        primaryContact: data.primaryContact ?? null,
        currentTeam: data.currentTeam ?? [],
        formerTeam: data.formerTeam ?? [],
        currentBoardMembersAndObservers: data.currentBoardMembersAndObservers ?? [],
        formerBoardMembersAndObservers: data.formerBoardMembersAndObservers ?? [],
      },
    }
  },

  outputs: {
    entityId: { type: 'string', description: 'PitchBook entity ID', nullable: true },
    primaryContact: {
      type: 'object',
      description: 'Primary contact at the entity',
      nullable: true,
      properties: {
        personId: { type: 'string', description: 'PitchBook person ID', nullable: true },
        fullName: { type: 'string', description: 'Full name', nullable: true },
        title: { type: 'string', description: 'Job title', nullable: true },
        phone: { type: 'string', description: 'Phone number', nullable: true },
        fax: { type: 'string', description: 'Fax number', nullable: true },
        email: { type: 'string', description: 'Email address', nullable: true },
      },
    },
    currentTeam: {
      type: 'array',
      description: 'People currently working at the entity',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'PitchBook person ID' },
          name: { type: 'string', description: 'Full name' },
          title: { type: 'string', description: 'Job title', nullable: true },
          positionStart: {
            type: 'string',
            description: 'Date the position started (YYYY-MM-DD)',
            nullable: true,
          },
          infoAvailable: {
            type: 'boolean',
            description: 'Whether a full person profile is available for them',
          },
        },
      },
    },
    formerTeam: {
      type: 'array',
      description: 'People who previously worked at the entity',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'PitchBook person ID' },
          name: { type: 'string', description: 'Full name' },
          title: { type: 'string', description: 'Job title', nullable: true },
          positionStart: {
            type: 'string',
            description: 'Date the position started (YYYY-MM-DD)',
            nullable: true,
          },
          positionFinish: {
            type: 'string',
            description: 'Date the position ended (YYYY-MM-DD)',
            nullable: true,
          },
          infoAvailable: {
            type: 'boolean',
            description: 'Whether a full person profile is available for them',
          },
        },
      },
    },
    currentBoardMembersAndObservers: {
      type: 'array',
      description: 'Current board members and observers',
      items: { type: 'object' },
    },
    formerBoardMembersAndObservers: {
      type: 'array',
      description: 'Former board members and observers',
      items: { type: 'object' },
    },
  },
}
