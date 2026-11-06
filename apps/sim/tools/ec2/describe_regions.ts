import type { Ec2DescribeRegionsParams, Ec2DescribeRegionsResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeRegionsTool: InternalToolConfig<
  Ec2DescribeRegionsParams,
  Ec2DescribeRegionsResponse
> = {
  id: 'ec2_describe_regions',
  name: 'EC2 Describe Regions',
  description: 'List AWS Regions available to the account',
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
    regionNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated region names to describe',
    },
    allRegions: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Regions that are not enabled for the account',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'EC2 filters as a JSON array, e.g. [{"Name":"opt-in-status","Values":["opted-in"]}]',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        regionNames: params.regionNames,
        allRegions: params.allRegions,
        filters: params.filters,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Regions')
    }

    return {
      success: true,
      output: {
        regions: data.regions ?? [],
      },
    }
  },

  outputs: {
    regions: {
      type: 'array',
      description: 'AWS Regions',
      items: {
        type: 'object',
        properties: {
          regionName: {
            type: 'string',
            description: 'Region name (e.g., us-east-1)',
          },
          endpoint: {
            type: 'string',
            description: 'EC2 endpoint for the Region',
            nullable: true,
          },
          optInStatus: {
            type: 'string',
            description: 'Opt-in status (opt-in-not-required, opted-in, not-opted-in)',
            nullable: true,
          },
        },
      },
    },
  },
}
