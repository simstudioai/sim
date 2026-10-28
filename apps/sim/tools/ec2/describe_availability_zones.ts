import type {
  Ec2DescribeAvailabilityZonesParams,
  Ec2DescribeAvailabilityZonesResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeAvailabilityZonesTool: InternalToolConfig<
  Ec2DescribeAvailabilityZonesParams,
  Ec2DescribeAvailabilityZonesResponse
> = {
  id: 'ec2_describe_availability_zones',
  name: 'EC2 Describe Availability Zones',
  description: 'List Availability Zones, Local Zones, and Wavelength Zones in the region',
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
    zoneNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated zone names (e.g., us-east-1a)',
    },
    allAvailabilityZones: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include zones that are not opted in',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'EC2 filters as a JSON array, e.g. [{"Name":"state","Values":["available"]}]',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        zoneNames: params.zoneNames,
        allAvailabilityZones: params.allAvailabilityZones,
        filters: params.filters,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Availability Zones')
    }

    return {
      success: true,
      output: {
        availabilityZones: data.availabilityZones ?? [],
      },
    }
  },

  outputs: {
    availabilityZones: {
      type: 'array',
      description: 'Zones',
      items: {
        type: 'object',
        properties: {
          zoneName: {
            type: 'string',
            description: 'Zone name (e.g., us-east-1a)',
          },
          zoneId: {
            type: 'string',
            description: 'Zone ID (e.g., use1-az1)',
            nullable: true,
          },
          zoneType: {
            type: 'string',
            description: 'Zone type (availability-zone, local-zone, wavelength-zone)',
            nullable: true,
          },
          state: {
            type: 'string',
            description: 'Zone state',
            nullable: true,
          },
          regionName: {
            type: 'string',
            description: 'Region name',
            nullable: true,
          },
          groupName: {
            type: 'string',
            description: 'Zone group name',
            nullable: true,
          },
          networkBorderGroup: {
            type: 'string',
            description: 'Network border group',
            nullable: true,
          },
          optInStatus: {
            type: 'string',
            description: 'Opt-in status',
            nullable: true,
          },
        },
      },
    },
  },
}
