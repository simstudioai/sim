import type {
  SsmListComplianceItemsParams,
  SsmListComplianceItemsResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const listComplianceItemsTool: InternalToolConfig<
  SsmListComplianceItemsParams,
  SsmListComplianceItemsResponse
> = {
  id: 'ssm_list_compliance_items',
  name: 'SSM List Compliance Items',
  description: 'List individual compliance findings reported to AWS Systems Manager',
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
    resourceIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resource to report on, as an array holding a single managed node ID',
    },
    resourceTypes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Resource type to report on, as an array holding a single value; currently only ManagedInstance is supported',
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
      description: 'Maximum number of compliance items to return (1-50)',
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
      resourceIds: params.resourceIds,
      resourceTypes: params.resourceTypes,
      filters: params.filters,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list compliance items')
    }

    return {
      success: true,
      output: {
        complianceItems: data.complianceItems ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    complianceItems: {
      type: 'json',
      description:
        'Compliance items, each with complianceType, resourceType, resourceId, id, title, status, severity, executionTime, executionId, executionType, and details',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: {
      type: 'number',
      description: 'Number of compliance items returned',
    },
  },
}
