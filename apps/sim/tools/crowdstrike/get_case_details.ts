import type {
  CrowdStrikeGetCaseDetailsParams,
  CrowdStrikeGetCaseDetailsResponse,
} from '@/tools/crowdstrike/types'
import type { InternalToolConfig } from '@/tools/types'

export const crowdstrikeGetCaseDetailsTool: InternalToolConfig<
  CrowdStrikeGetCaseDetailsParams,
  CrowdStrikeGetCaseDetailsResponse
> = {
  id: 'crowdstrike_get_case_details',
  name: 'CrowdStrike Get Case Details',
  description:
    'Get CrowdStrike Falcon Case Management case records for one or more case IDs (POST /cases/entities/cases/v2). Requires the "Cases: Read" API scope.',
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
    caseIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of CrowdStrike case IDs',
    },
  },

  operation: {
    input: (params) => ({
      caseIds: params.caseIds,
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      operation: 'crowdstrike_get_case_details',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to fetch CrowdStrike case details')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    cases: {
      type: 'array',
      description: 'CrowdStrike Case Management case records',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Case identifier', optional: true },
          cid: { type: 'string', description: 'CrowdStrike customer identifier', optional: true },
          name: { type: 'string', description: 'Case name', optional: true },
          description: { type: 'string', description: 'Case description', optional: true },
          descriptionFormat: {
            type: 'string',
            description: 'Format of the case description',
            optional: true,
          },
          status: { type: 'string', description: 'Case status', optional: true },
          severity: { type: 'number', description: 'Numeric case severity', optional: true },
          severityLevel: {
            type: 'string',
            description: 'Case severity level name',
            optional: true,
          },
          referenceId: {
            type: 'string',
            description: 'Human-readable case reference ID',
            optional: true,
          },
          version: {
            type: 'number',
            description: 'Case version for optimistic concurrency',
            optional: true,
          },
          tags: {
            type: 'array',
            description: 'Tags applied to the case',
            optional: true,
            items: { type: 'string' },
          },
          assignedTo: {
            type: 'json',
            description: 'Falcon user the case is assigned to',
            optional: true,
            properties: {
              uuid: { type: 'string', description: 'Falcon user UUID', optional: true },
              email: { type: 'string', description: 'Falcon user email', optional: true },
              fullName: { type: 'string', description: 'Falcon user full name', optional: true },
            },
          },
          createdBy: {
            type: 'json',
            description: 'Falcon user who created the case',
            optional: true,
            properties: {
              uuid: { type: 'string', description: 'Falcon user UUID', optional: true },
              email: { type: 'string', description: 'Falcon user email', optional: true },
              fullName: { type: 'string', description: 'Falcon user full name', optional: true },
            },
          },
          lastUpdatedBy: {
            type: 'json',
            description: 'Falcon user who last updated the case',
            optional: true,
            properties: {
              uuid: { type: 'string', description: 'Falcon user UUID', optional: true },
              email: { type: 'string', description: 'Falcon user email', optional: true },
              fullName: { type: 'string', description: 'Falcon user full name', optional: true },
            },
          },
          createdTimestamp: {
            type: 'string',
            description: 'Case creation timestamp',
            optional: true,
          },
          updatedTimestamp: {
            type: 'string',
            description: 'Case update timestamp',
            optional: true,
          },
          startTimestamp: { type: 'string', description: 'Case start timestamp', optional: true },
          endTimestamp: { type: 'string', description: 'Case end timestamp', optional: true },
          templateId: { type: 'string', description: 'Case template identifier', optional: true },
          templateName: { type: 'string', description: 'Case template name', optional: true },
          slaId: {
            type: 'string',
            description: 'SLA identifier applied to the case',
            optional: true,
          },
          slaName: { type: 'string', description: 'SLA name applied to the case', optional: true },
          isReadOnly: {
            type: 'boolean',
            description: 'Whether the case is read only',
            optional: true,
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of cases returned',
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
