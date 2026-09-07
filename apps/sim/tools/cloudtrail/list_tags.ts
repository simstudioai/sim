import type { CloudTrailListTagsParams, CloudTrailListTagsResponse } from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const listTagsTool: InternalToolConfig<
  CloudTrailListTagsParams,
  CloudTrailListTagsResponse
> = {
  id: 'cloudtrail_list_tags',
  name: 'CloudTrail List Tags',
  description: 'List the tags on CloudTrail trails, event data stores, dashboards, or channels',
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
    resourceIdList: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated CloudTrail resource ARNs, up to 20',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reserved for future use by AWS',
    },
  },

  operation: {
    input: (params) => {
      const resourceIdList = params.resourceIdList
        .split(',')
        .map((arn) => arn.trim())
        .filter(Boolean)
      return {
        region: params.awsRegion,
        accessKeyId: params.awsAccessKeyId,
        secretAccessKey: params.awsSecretAccessKey,
        resourceIdList,
        ...(params.nextToken && { nextToken: params.nextToken }),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list CloudTrail resource tags')
    }
    return {
      success: true,
      output: {
        resourceTags: data.output.resourceTags ?? [],
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    resourceTags: {
      type: 'array',
      description: 'Tags for each requested resource',
      items: {
        type: 'object',
        properties: {
          resourceId: { type: 'string', description: 'ARN of the tagged resource' },
          tags: { type: 'array', description: 'Tags on the resource, as key and value' },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Reserved for future use by AWS',
      optional: true,
    },
  },
}
