import type { AthenaListWorkGroupsParams, AthenaListWorkGroupsResponse } from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const listWorkGroupsTool: InternalToolConfig<
  AthenaListWorkGroupsParams,
  AthenaListWorkGroupsResponse
> = {
  id: 'athena_list_work_groups',
  name: 'Athena List Workgroups',
  description: 'List the Athena workgroups available in the AWS account',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (1-50)',
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
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Athena workgroups')
    }
    return {
      success: true,
      output: {
        workGroups: data.output.workGroups ?? [],
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    workGroups: {
      type: 'array',
      description: 'Workgroup summaries',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Workgroup name' },
          state: {
            type: 'string',
            description: 'Workgroup state (ENABLED, DISABLED)',
            optional: true,
          },
          description: { type: 'string', description: 'Workgroup description', optional: true },
          creationTime: {
            type: 'number',
            description: 'Creation time (Unix epoch ms)',
            optional: true,
          },
          engineVersion: {
            type: 'json',
            description: 'Engine version setting (selected and effective versions)',
            optional: true,
            properties: {
              selectedEngineVersion: {
                type: 'string',
                description: 'Requested engine version',
                optional: true,
              },
              effectiveEngineVersion: {
                type: 'string',
                description: 'Engine version Athena actually uses',
                optional: true,
              },
            },
          },
          identityCenterApplicationArn: {
            type: 'string',
            description: 'IAM Identity Center application ARN',
            optional: true,
          },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for next page',
      optional: true,
    },
  },
}
