import type {
  CrowdStrikeGetIndicatorDetailsParams,
  CrowdStrikeGetIndicatorDetailsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeGetIndicatorDetailsTool: ToolConfig<
  CrowdStrikeGetIndicatorDetailsParams,
  CrowdStrikeGetIndicatorDetailsResponse
> = {
  id: 'crowdstrike_get_indicator_details',
  name: 'CrowdStrike Get Indicator Details',
  description:
    'Get custom CrowdStrike Falcon indicator of compromise (IOC) records for one or more IOC IDs (GET /iocs/entities/indicators/v1). Requires the "IOC Management: Read" API scope.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client secret',
    },
    cloud: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon cloud region',
    },
    indicatorIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of CrowdStrike IOC IDs',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      indicatorIds: params.indicatorIds,
      operation: 'crowdstrike_get_indicator_details',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to fetch CrowdStrike indicator details')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    indicators: {
      type: 'array',
      description: 'CrowdStrike indicator of compromise records',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Indicator identifier', optional: true },
          type: { type: 'string', description: 'Indicator type', optional: true },
          value: { type: 'string', description: 'Indicator value', optional: true },
          action: {
            type: 'string',
            description: 'Action taken when the indicator matches',
            optional: true,
          },
          mobileAction: {
            type: 'string',
            description: 'Action taken on mobile platforms when the indicator matches',
            optional: true,
          },
          severity: { type: 'string', description: 'Indicator severity', optional: true },
          description: { type: 'string', description: 'Indicator description', optional: true },
          source: { type: 'string', description: 'Indicator source', optional: true },
          appliedGlobally: {
            type: 'boolean',
            description: 'Whether the indicator applies to all hosts',
            optional: true,
          },
          platforms: {
            type: 'array',
            description: 'Platforms the indicator applies to',
            optional: true,
            items: { type: 'string' },
          },
          hostGroups: {
            type: 'array',
            description: 'Host group IDs the indicator is scoped to',
            optional: true,
            items: { type: 'string' },
          },
          tags: {
            type: 'array',
            description: 'Tags applied to the indicator',
            optional: true,
            items: { type: 'string' },
          },
          expiration: {
            type: 'string',
            description: 'Indicator expiration timestamp',
            optional: true,
          },
          expired: {
            type: 'boolean',
            description: 'Whether the indicator has expired',
            optional: true,
          },
          deleted: {
            type: 'boolean',
            description: 'Whether the indicator is deleted',
            optional: true,
          },
          fromParent: {
            type: 'boolean',
            description: 'Whether the indicator was inherited from a parent CID',
            optional: true,
          },
          parentCidName: { type: 'string', description: 'Parent CID name', optional: true },
          createdBy: {
            type: 'string',
            description: 'User who created the indicator',
            optional: true,
          },
          createdOn: {
            type: 'string',
            description: 'Indicator creation timestamp',
            optional: true,
          },
          modifiedBy: {
            type: 'string',
            description: 'User who last modified the indicator',
            optional: true,
          },
          modifiedOn: {
            type: 'string',
            description: 'Indicator modification timestamp',
            optional: true,
          },
          metadata: {
            type: 'json',
            description: 'File metadata CrowdStrike resolved for the indicator',
            optional: true,
            properties: {
              avHits: { type: 'number', description: 'Antivirus hit count', optional: true },
              companyName: { type: 'string', description: 'Company name', optional: true },
              fileDescription: { type: 'string', description: 'File description', optional: true },
              fileVersion: { type: 'string', description: 'File version', optional: true },
              filename: { type: 'string', description: 'File name', optional: true },
              originalFilename: {
                type: 'string',
                description: 'Original file name',
                optional: true,
              },
              productName: { type: 'string', description: 'Product name', optional: true },
              productVersion: { type: 'string', description: 'Product version', optional: true },
              signed: {
                type: 'boolean',
                description: 'Whether the file is signed',
                optional: true,
              },
            },
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of indicators returned',
    },
    errors: {
      type: 'array',
      description: 'Errors CrowdStrike returned alongside a partially successful response',
      optional: true,
      items: {
        type: 'object',
        properties: {
          code: { type: 'number', description: 'CrowdStrike error code', optional: true },
          id: { type: 'string', description: 'Identifier the error applies to', optional: true },
          message: { type: 'string', description: 'Error message', optional: true },
        },
      },
    },
  },
}
