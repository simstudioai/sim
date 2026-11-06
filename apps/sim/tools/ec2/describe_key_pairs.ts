import {
  EC2_TAGS_OUTPUT,
  type Ec2DescribeKeyPairsParams,
  type Ec2DescribeKeyPairsResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeKeyPairsTool: InternalToolConfig<
  Ec2DescribeKeyPairsParams,
  Ec2DescribeKeyPairsResponse
> = {
  id: 'ec2_describe_key_pairs',
  name: 'EC2 Describe Key Pairs',
  description: 'List EC2 key pairs with their type, fingerprint, and creation time',
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
    keyNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated key pair names',
    },
    keyPairIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated key pair IDs (e.g., key-0abc123)',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'EC2 filters as a JSON array, e.g. [{"Name":"key-name","Values":["deploy-*"]}]',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        keyNames: params.keyNames,
        keyPairIds: params.keyPairIds,
        filters: params.filters,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Key Pairs')
    }

    return {
      success: true,
      output: {
        keyPairs: data.keyPairs ?? [],
      },
    }
  },

  outputs: {
    keyPairs: {
      type: 'array',
      description: 'Key pairs',
      items: {
        type: 'object',
        properties: {
          keyPairId: {
            type: 'string',
            description: 'Key pair ID',
          },
          keyName: {
            type: 'string',
            description: 'Key pair name',
            nullable: true,
          },
          keyType: {
            type: 'string',
            description: 'Key type (rsa or ed25519)',
            nullable: true,
          },
          keyFingerprint: {
            type: 'string',
            description: 'Key fingerprint',
            nullable: true,
          },
          createTime: {
            type: 'string',
            description: 'Creation time (ISO 8601)',
            nullable: true,
          },
          tags: EC2_TAGS_OUTPUT,
        },
      },
    },
  },
}
