import type {
  SsmListComplianceSummariesParams,
  SsmListComplianceSummariesResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const listComplianceSummariesTool: InternalToolConfig<
  SsmListComplianceSummariesParams,
  SsmListComplianceSummariesResponse
> = {
  id: 'ssm_list_compliance_summaries',
  name: 'SSM List Compliance Summaries',
  description: 'Read compliant and non-compliant counts per compliance type',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filters, as an array of {Key, Values, Type} objects. Type is one of EQUAL, NOT_EQUAL, BEGIN_WITH, LESS_THAN, GREATER_THAN',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of summaries to return (1-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      filters: params.filters,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list compliance summaries')
    }

    return {
      success: true,
      output: {
        complianceSummaryItems: data.complianceSummaryItems ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    complianceSummaryItems: {
      type: 'json',
      description:
        'Summaries, each with complianceType, compliantCount, compliantSeveritySummary, nonCompliantCount, and nonCompliantSeveritySummary',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: {
      type: 'number',
      description: 'Number of summaries returned',
    },
  },
}
