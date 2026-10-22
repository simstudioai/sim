import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeNetworkInterfacesParams,
  type Ec2DescribeNetworkInterfacesResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const describeNetworkInterfacesTool: InternalToolConfig<
  Ec2DescribeNetworkInterfacesParams,
  Ec2DescribeNetworkInterfacesResponse
> = {
  id: 'ec2_describe_network_interfaces',
  name: 'EC2 Describe Network Interfaces',
  description: 'List elastic network interfaces with their IPs, attachment, and security groups',
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
    networkInterfaceIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated network interface IDs (e.g., eni-0abc123)',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'EC2 filters as a JSON array, e.g. [{"Name":"vpc-id","Values":["vpc-0abc123"]}]',
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
        networkInterfaceIds: params.networkInterfaceIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Network Interfaces')
    }

    return {
      success: true,
      output: {
        networkInterfaces: data.networkInterfaces ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    networkInterfaces: {
      type: 'array',
      description: 'Network interfaces',
      items: {
        type: 'object',
        properties: {
          networkInterfaceId: {
            type: 'string',
            description: 'Network interface ID',
          },
          interfaceType: {
            type: 'string',
            description: 'Interface type (e.g., interface, nat_gateway, lambda)',
            nullable: true,
          },
          status: {
            type: 'string',
            description: 'Status (available, in-use, attaching, detaching)',
            nullable: true,
          },
          description: {
            type: 'string',
            description: 'Description',
            nullable: true,
          },
          vpcId: {
            type: 'string',
            description: 'VPC ID',
            nullable: true,
          },
          subnetId: {
            type: 'string',
            description: 'Subnet ID',
            nullable: true,
          },
          availabilityZone: {
            type: 'string',
            description: 'Availability Zone',
            nullable: true,
          },
          privateIpAddress: {
            type: 'string',
            description: 'Primary private IPv4 address',
            nullable: true,
          },
          privateIpAddresses: {
            type: 'array',
            description: 'All private IPv4 addresses',
            items: { type: 'string' },
          },
          publicIp: {
            type: 'string',
            description: 'Associated public IPv4 address',
            nullable: true,
          },
          macAddress: {
            type: 'string',
            description: 'MAC address',
            nullable: true,
          },
          requesterManaged: {
            type: 'boolean',
            description: 'Whether an AWS service manages the interface',
          },
          attachment: {
            type: 'object',
            description: 'Instance attachment, if attached',
            nullable: true,
            properties: {
              attachmentId: {
                type: 'string',
                description: 'Attachment ID',
                nullable: true,
              },
              instanceId: {
                type: 'string',
                description: 'Attached instance ID',
                nullable: true,
              },
              deviceIndex: {
                type: 'number',
                description: 'Device index on the instance',
                nullable: true,
              },
              status: {
                type: 'string',
                description: 'Attachment status',
                nullable: true,
              },
              deleteOnTermination: {
                type: 'boolean',
                description: 'Whether the interface is deleted when the instance terminates',
                nullable: true,
              },
            },
          },
          securityGroups: {
            type: 'array',
            description: 'Attached security groups',
            items: {
              type: 'object',
              properties: {
                groupId: {
                  type: 'string',
                  description: 'Security group ID',
                  nullable: true,
                },
                groupName: {
                  type: 'string',
                  description: 'Security group name',
                  nullable: true,
                },
              },
            },
          },
          tags: EC2_TAGS_OUTPUT,
        },
      },
    },
    nextToken: EC2_NEXT_TOKEN_OUTPUT,
  },
}
