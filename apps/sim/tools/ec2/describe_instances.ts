import {
  EC2_NEXT_TOKEN_OUTPUT,
  EC2_TAGS_OUTPUT,
  type Ec2DescribeInstancesParams,
  type Ec2DescribeInstancesResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const describeInstancesTool: InternalToolConfig<
  Ec2DescribeInstancesParams,
  Ec2DescribeInstancesResponse
> = {
  id: 'ec2_describe_instances',
  name: 'EC2 Describe Instances',
  description: 'List EC2 instances with their state, type, networking, and tags',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

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
    instanceIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated instance IDs (e.g., i-0abc123,i-0def456). Leave empty to list all',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'EC2 filters as a JSON array, e.g. [{"Name":"instance-state-name","Values":["running"]}]',
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
        instanceIds: params.instanceIds,
        filters: params.filters,
        maxResults: params.maxResults,
        nextToken: params.nextToken,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Describe Instances')
    }

    return {
      success: true,
      output: {
        instances: data.instances ?? [],
        nextToken: data.nextToken ?? null,
      },
    }
  },

  outputs: {
    instances: {
      type: 'array',
      description: 'EC2 instances',
      items: {
        type: 'object',
        properties: {
          instanceId: {
            type: 'string',
            description: 'Instance ID',
          },
          instanceType: {
            type: 'string',
            description: 'Instance type (e.g., t3.micro)',
            nullable: true,
          },
          state: {
            type: 'string',
            description:
              'Instance state (pending, running, stopping, stopped, shutting-down, terminated)',
            nullable: true,
          },
          stateCode: {
            type: 'number',
            description:
              'Numeric state code (0 pending, 16 running, 32 shutting-down, 48 terminated, 64 stopping, 80 stopped)',
            nullable: true,
          },
          stateReason: {
            type: 'string',
            description: 'Reason for the most recent state transition',
            nullable: true,
          },
          stateReasonCode: {
            type: 'string',
            description:
              'Code for the most recent state change (e.g., Client.UserInitiatedShutdown)',
            nullable: true,
          },
          stateTransitionReason: {
            type: 'string',
            description: 'Reason for the most recent state transition, including when it happened',
            nullable: true,
          },
          reservationId: {
            type: 'string',
            description: 'Reservation ID the instance was launched in',
            nullable: true,
          },
          ownerId: {
            type: 'string',
            description: 'AWS account ID that owns the reservation',
            nullable: true,
          },
          launchTime: {
            type: 'string',
            description: 'Launch time (ISO 8601)',
            nullable: true,
          },
          availabilityZone: {
            type: 'string',
            description: 'Availability Zone',
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
          privateIpAddress: {
            type: 'string',
            description: 'Primary private IPv4 address',
            nullable: true,
          },
          publicIpAddress: {
            type: 'string',
            description: 'Public IPv4 address',
            nullable: true,
          },
          privateDnsName: {
            type: 'string',
            description: 'Private DNS name',
            nullable: true,
          },
          publicDnsName: {
            type: 'string',
            description: 'Public DNS name',
            nullable: true,
          },
          imageId: {
            type: 'string',
            description: 'AMI ID used to launch the instance',
            nullable: true,
          },
          keyName: {
            type: 'string',
            description: 'Key pair name',
            nullable: true,
          },
          platformDetails: {
            type: 'string',
            description: 'Platform details (e.g., Linux/UNIX, Windows)',
            nullable: true,
          },
          platform: {
            type: 'string',
            description: 'Set to Windows for Windows instances; null for Linux/UNIX',
            nullable: true,
          },
          architecture: {
            type: 'string',
            description: 'CPU architecture',
            nullable: true,
          },
          iamInstanceProfileArn: {
            type: 'string',
            description: 'ARN of the attached IAM instance profile',
            nullable: true,
          },
          ipv6Address: {
            type: 'string',
            description: 'Primary IPv6 address',
            nullable: true,
          },
          tenancy: {
            type: 'string',
            description: 'Placement tenancy (default, dedicated, host)',
            nullable: true,
          },
          instanceLifecycle: {
            type: 'string',
            description:
              'Lifecycle type (e.g., spot, scheduled, capacity-block); null for On-Demand',
            nullable: true,
          },
          spotInstanceRequestId: {
            type: 'string',
            description: 'Spot Instance request ID',
            nullable: true,
          },
          monitoringState: {
            type: 'string',
            description: 'Detailed monitoring state (disabled, disabling, enabled, pending)',
            nullable: true,
          },
          ebsOptimized: {
            type: 'boolean',
            description: 'Whether the instance is EBS-optimized',
            nullable: true,
          },
          rootDeviceName: {
            type: 'string',
            description: 'Root device name (e.g., /dev/xvda)',
            nullable: true,
          },
          rootDeviceType: {
            type: 'string',
            description: 'Root device type (ebs or instance-store)',
            nullable: true,
          },
          metadataHttpTokens: {
            type: 'string',
            description:
              'IMDS token requirement; required means IMDSv2 only, optional allows IMDSv1',
            nullable: true,
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
          blockDeviceMappings: {
            type: 'array',
            description: 'Attached EBS volumes',
            items: {
              type: 'object',
              properties: {
                deviceName: {
                  type: 'string',
                  description: 'Device name (e.g., /dev/sdh)',
                  nullable: true,
                },
                volumeId: { type: 'string', description: 'EBS volume ID', nullable: true },
                status: {
                  type: 'string',
                  description: 'Attachment state (attaching, attached, detaching, detached)',
                  nullable: true,
                },
                attachTime: {
                  type: 'string',
                  description: 'Attach time (ISO 8601)',
                  nullable: true,
                },
                deleteOnTermination: {
                  type: 'boolean',
                  description: 'Whether the volume is deleted when the instance terminates',
                  nullable: true,
                },
              },
            },
          },
          networkInterfaces: {
            type: 'array',
            description: 'Attached network interfaces',
            items: {
              type: 'object',
              properties: {
                networkInterfaceId: {
                  type: 'string',
                  description: 'Network interface ID',
                  nullable: true,
                },
                subnetId: { type: 'string', description: 'Subnet ID', nullable: true },
                vpcId: { type: 'string', description: 'VPC ID', nullable: true },
                privateIpAddress: {
                  type: 'string',
                  description: 'Primary private IPv4 address',
                  nullable: true,
                },
                publicIp: {
                  type: 'string',
                  description: 'Associated public IPv4 address',
                  nullable: true,
                },
                macAddress: { type: 'string', description: 'MAC address', nullable: true },
                status: {
                  type: 'string',
                  description:
                    'Interface status (available, associated, attaching, in-use, detaching)',
                  nullable: true,
                },
                deviceIndex: {
                  type: 'number',
                  description: 'Device index on the instance (0 is the primary interface)',
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
