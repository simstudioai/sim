import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeImagesParams,
  type Ec2DescribeImagesResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeImagesTool: InternalToolConfig<
  Ec2DescribeImagesParams,
  Ec2DescribeImagesResponse
> = {
  id: 'ec2_describe_images',
  name: 'EC2 Describe Images',
  description: 'List AMIs owned by the account (or by the owners you specify)',
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
    imageIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated AMI IDs (e.g., ami-0abc123)',
    },
    owners: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated owners: AWS account IDs, self, amazon, or aws-marketplace (defaults to self)',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'EC2 filters as a JSON array, e.g. [{"Name":"name","Values":["my-app-*"]}]',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results per page when no IDs are given (5-1000, default 100)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        imageIds: params.imageIds,
        owners: params.owners,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Images')
    }

    return {
      success: true,
      output: {
        images: data.images ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    images: {
      type: 'array',
      description: 'AMIs',
      items: {
        type: 'object',
        properties: {
          imageId: {
            type: 'string',
            description: 'AMI ID',
          },
          name: {
            type: 'string',
            description: 'AMI name',
            nullable: true,
          },
          description: {
            type: 'string',
            description: 'Description',
            nullable: true,
          },
          state: {
            type: 'string',
            description:
              'State (pending, available, invalid, deregistered, transient, failed, error, disabled)',
            nullable: true,
          },
          ownerId: {
            type: 'string',
            description: 'Owning AWS account ID',
            nullable: true,
          },
          ownerAlias: {
            type: 'string',
            description: 'Owner alias (e.g., amazon)',
            nullable: true,
          },
          public: {
            type: 'boolean',
            description: 'Whether the AMI is public',
          },
          architecture: {
            type: 'string',
            description: 'CPU architecture',
            nullable: true,
          },
          platformDetails: {
            type: 'string',
            description: 'Platform details (e.g., Linux/UNIX)',
            nullable: true,
          },
          rootDeviceType: {
            type: 'string',
            description: 'Root device type (ebs or instance-store)',
            nullable: true,
          },
          virtualizationType: {
            type: 'string',
            description: 'Virtualization type (hvm or paravirtual)',
            nullable: true,
          },
          creationDate: {
            type: 'string',
            description: 'Creation date (ISO 8601)',
            nullable: true,
          },
          deprecationTime: {
            type: 'string',
            description: 'Deprecation time (ISO 8601)',
            nullable: true,
          },
          lastLaunchedTime: {
            type: 'string',
            description: 'Last time an instance was launched from the AMI (ISO 8601)',
            nullable: true,
          },
          tags: EC2_TAGS_OUTPUT,
        },
      },
    },
    nextToken: EC2_NEXT_TOKEN_OUTPUT,
  },
}
