import type { Ec2DeleteTagsParams, Ec2DeleteTagsResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const deleteTagsTool: InternalToolConfig<Ec2DeleteTagsParams, Ec2DeleteTagsResponse> = {
  id: 'ec2_delete_tags',
  name: 'EC2 Delete Tags',
  description: 'Remove tags from one or more EC2 resources',
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
      description: 'Comma-separated resource IDs to untag',
    },
    tagKeys: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag keys to remove',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        resourceIds: params.resourceIds,
        tagKeys: params.tagKeys,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Delete Tags')
    }

    return {
      success: true,
      output: {
        resourceIds: data.resourceIds ?? [],
        tagKeys: data.tagKeys ?? [],
      },
    }
  },

  outputs: {
    resourceIds: {
      type: 'array',
      description: 'Resource IDs that were untagged',
      items: { type: 'string' },
    },
    tagKeys: {
      type: 'array',
      description: 'Tag keys that were removed',
      items: { type: 'string' },
    },
  },
}
