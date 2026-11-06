import {
  EC2_TAGS_OUTPUT,
  type Ec2CreateTagsParams,
  type Ec2CreateTagsResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const createTagsTool: InternalToolConfig<Ec2CreateTagsParams, Ec2CreateTagsResponse> = {
  id: 'ec2_create_tags',
  name: 'EC2 Create Tags',
  description: 'Add or overwrite tags on one or more EC2 resources',
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
    resourceIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated resource IDs to tag (e.g., i-0abc123,vol-0def456)',
    },
    tags: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tags as a JSON object, e.g. {"Environment":"prod","Owner":"platform"}',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        resourceIds: params.resourceIds,
        tags: params.tags,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Create Tags')
    }

    return {
      success: true,
      output: {
        resourceIds: data.resourceIds ?? [],
        tags: data.tags ?? {},
      },
    }
  },

  outputs: {
    resourceIds: {
      type: 'array',
      description: 'Resource IDs that were tagged',
      items: { type: 'string' },
    },
    tags: EC2_TAGS_OUTPUT,
  },
}
