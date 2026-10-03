import type {
  CloudTrailListTrailsParams,
  CloudTrailListTrailsResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const listTrailsTool: InternalToolConfig<
  CloudTrailListTrailsParams,
  CloudTrailListTrailsResponse
> = {
  id: 'cloudtrail_list_trails',
  name: 'CloudTrail List Trails',
  description:
    'List the ARN, name, and home Region of every CloudTrail trail visible to the account',
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
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous list request',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list CloudTrail trails')
    }
    return {
      success: true,
      output: {
        trails: data.output.trails ?? [],
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    trails: {
      type: 'array',
      description: 'Trail summaries',
      items: {
        type: 'object',
        properties: {
          trailArn: { type: 'string', description: 'ARN of the trail', nullable: true },
          name: { type: 'string', description: 'Trail name', nullable: true },
          homeRegion: {
            type: 'string',
            description: 'Region in which the trail was created',
            nullable: true,
          },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of trails, or null on the last page',
      nullable: true,
    },
  },
}
